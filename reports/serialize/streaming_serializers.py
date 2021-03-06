# -*- coding: utf-8 -*-
'''
Utilities for streaming sql connection cursors to different serialization formats.
'''

from __future__ import unicode_literals

import cStringIO
from collections import OrderedDict
import json
import logging
import numbers
import os.path
import re
import shutil
from tempfile import NamedTemporaryFile
import time
from wsgiref.util import FileWrapper
from zipfile import ZipFile

from django.conf import settings
from django.db.utils import ProgrammingError
from django.http.response import StreamingHttpResponse, Http404
import six
import unicodecsv
import xlsxwriter

from reports import LIST_DELIMITER_SQL_ARRAY, \
    MAX_IMAGE_ROWS_PER_XLS_FILE, MAX_ROWS_PER_XLS_FILE, \
    CSV_DELIMITER
from reports.serialize import XLSX_MIMETYPE, LimsJSONEncoder, encode_utf8, \
    ZIP_MIMETYPE
import reports.serialize
import reports.serialize.csvutils as csvutils
import reports.serialize.sdfutils as sdfutils
from reports.serialize.xlsutils import generic_xls_write_workbook, \
    xls_write_workbook, write_xls_image, LIST_DELIMITER_XLS
from reports.utils import default_converter


logger = logging.getLogger(__name__)

MOLDATAKEY = sdfutils.MOLDATAKEY

DEBUG_STREAMING = False or logger.isEnabledFor(logging.DEBUG)


def closing_iterator_wrapper(iterable, close):
    '''For use with database connections that must be closed after iterating.'''
    try:
        for item in iterable:
            yield item
    finally:
        logger.debug('close connection...')
        close()

class ChunkIterWrapper(object):
    ''' 
    Iterate over a byte array in fixed "chunks" of chunk_size bytes.
    '''
    def __init__(self, iter_stream, chunk_size = 1024**2):
        self.iter_stream = iter_stream
        self.chunk_size = chunk_size
        self.fragment = None
    
    def next(self):
        logger.debug('chunking')
        bytes = cStringIO.StringIO()
        
        bytecount = 0
        try:
            
            if self.fragment:
                
                # FIXME: if fragment (row remainder) is still > chunk_size, 
                # will just serve it here; e.g. from long rows.
                bytecount = len(self.fragment)
                bytes.write(self.fragment)
                self.fragment = None

            while bytecount < self.chunk_size:
            
                row = self.iter_stream.next()
                rowlen = len(row)
                
                if bytecount + rowlen < self.chunk_size:
                    bytes.write(row)
                    bytecount += rowlen
                else:
                    nextbytes = self.chunk_size-bytecount
                    bytes.write(row[:nextbytes])
                    self.fragment = row[nextbytes:]
                    bytecount += nextbytes
        
        except StopIteration:
            if self.fragment:
                bytes.write(self.fragment)
                self.fragment = None
            else:
                raise StopIteration
        except Exception, e:
            logger.exception('streaming exception')
            raise e   
        finally:
            if bytes.getvalue():
                logger.debug('chunk size %s bytes' % len(bytes.getvalue()))
                return bytes.getvalue()
            else:
                logger.debug('normal stop iteration, fragment: %s, bytes: %s' 
                    % ( self.fragment, bytes.getvalue()))
                raise StopIteration

    def __iter__(self):
        return self


def interpolate_value_template(value_template, row):
    ''' 
    Utility function interpolating the values defined in the "value_template":
    "text... {field_name} ..text"
    wherein the {field_name} is replaced with the field-value
    '''                
    def get_value_from_template(matchobj):
        val = matchobj.group()
        val = re.sub(r'[{}]+', '', val)
        if DEBUG_STREAMING:
            logger.info('val from value template: %r, %r, %r',
                val,row.has_key(val), row[val])
        if row.has_key(val):
            return row[val]
            # FIXME: 20170731 review utf encoding here
            # return encode_utf8(row[val])
        else:
            logger.error(
                'field %r needed for value template %r is not available: %r', 
                val, value_template, dict(zip(row.keys(),row)))
            return ''
    return re.sub(r'{([^}]+)}', get_value_from_template, value_template)

def image_generator(rows, image_keys, request):
    '''
    Check that any image values in the rows can be fetched:
    - replace the raw value given with the absolute URI
    
    @param rows an iterator that returns a dict for each row
    
    TODO: inject or wrap dependency on well.library_well_type 
    '''
    for row in rows:
        for key,val in row.items():
            if not val:
                continue
            if key in image_keys:
                # Hack to speed things up for the db.api:
                if ( key == 'structure_image' and
                        'library_well_type' in row and
                        row['library_well_type'] == 'empty' ):
                    row[key] = None
                else:
                    try:
                        # Test whether image exists
                        image = reports.serialize.resolve_image(request, val)
                        # If it exists, write the fullpath to the file
                        fullpath = request.build_absolute_uri(val)
                        logger.debug(
                            'image exists: %r, abs_uri: %r', val, fullpath)
                        row[key] = fullpath
                    except Http404, e:
                        logger.debug('no image found at: %r', val)
                        row[key] = None
                    except Exception, e:
                        logger.exception(
                            'image could not be retrieved: %r, e: %r',
                            val, e)
                        row[key] = None
        yield row


def json_generator(data, meta, is_for_detail=False):
    '''Yield the given data list as a JSON encoded char array'''
    
    if DEBUG_STREAMING: logger.info('meta: %r', meta )
    
    # NOTE, using "ensure_ascii" = True to force encoding of all 
    # chars to be encoded using ascii or escaped unicode; 
    # because some chars in db might be non-UTF8
    # and downstream programs have trouble with mixed encoding (cStringIO)
    if not is_for_detail:
        yield ( '{ "meta": %s, "objects": [' 
            % json.dumps(meta, cls=LimsJSONEncoder, ensure_ascii=True, encoding="utf-8"))
    try:
        for rownum, row in enumerate(data):
            try:
                if rownum == 0:
                    # NOTE, using "ensure_ascii" = True to force encoding of all 
                    # chars to the ascii charset; otherwise, cStringIO has problems
                    yield json.dumps(row, cls=LimsJSONEncoder,
                        sort_keys=True, ensure_ascii=True, indent=2, encoding="utf-8")
                else:
                    # NOTE, using "ensure_ascii" = True to force encoding of all 
                    # chars to the ascii charset; otherwise, cStringIO has problems
                    # e.g. "tm" becomes \u2122
                    # CStringIO doesn't support UTF-8 mixed with ascii, for instance
                    # NOTE2: control characters are not allowed: should convert \n to "\\n"
                    yield ', ' + json.dumps(row, cls=LimsJSONEncoder,
                        sort_keys=True, ensure_ascii=True, indent=2, encoding="utf-8")
            except Exception, e:
                logger.exception('dict: %r', row)
                raise e
        logger.debug('streaming finished')
        
        if not is_for_detail:
            yield ' ] }'
    except Exception, e:
        logger.exception('json streaming')
        raise e                      


class Echo(object):
    '''Implement the write method of the file-like interface.'''
    
    def write(self, value):
        return value


def csv_generator(data, title_function=None, list_brackets=None):    
    '''Yield the given data list as a CSV encoded char array'''
    
    pseudo_buffer = Echo()
    quotechar = b'"' # note that csv under python 2.7 doesn't allow multibyte quote char
    csvwriter = unicodecsv.writer(
        pseudo_buffer, delimiter=CSV_DELIMITER, quotechar=quotechar, 
        quoting=unicodecsv.QUOTE_MINIMAL, lineterminator="\n")
    try:
        count = 0
        for rownum, row in enumerate(data):
            if rownum == 0:
                titles = row.keys()
                if title_function:
                    titles = [title_function(key) for key in titles]
                yield csvwriter.writerow(titles)
            count = rownum
            yield csvwriter.writerow([
                csvutils.convert_list_vals(val, list_brackets=list_brackets) 
                    for val in row.values()])
        logger.debug('wrote %d rows to csv', count)
    except Exception, e:
        logger.exception('CSV streaming error')
        raise e                      


def sdf_generator(data, title_function=None):    
    '''
    Yield the given data list as a SDF molfile encoded char array.
    
    Mimetype: chemical/x-mdl-sdfile
    see: http://download.accelrys.com/freeware/ctfile-formats/ctfile-formats.zip
    '''
    try:
        rownum = 0
        for rownum,row in enumerate(data):

            if row.get(MOLDATAKEY, None):
                yield str(row[MOLDATAKEY])
                yield '\n' 

            for i, (key,val) in enumerate(row.items()):
        
                if key == MOLDATAKEY:
                    continue
                title = key
                if title_function:
                    title = encode_utf8(title_function(key))
                yield '> <%s>\n' % title
                if val is not None:
                    # Note: find lists, but not strings (or dicts)
                    # Note: a dict here will be non-standard; probably an error 
                    # report, so just stringify dicts as is.
                    if not hasattr(val, "strip") and isinstance(val, (list,tuple)): 
                        for x in val:
                            # DB should be UTF-8, so this should not be necessary,
                            # however, it appears we have legacy non-UTF-8 data 
                            # (which creates a non proper unicode string) 
                            # some tables (i.e. small_molecule_compound_name 193090
                            yield encode_utf8(x)
                            yield '\n'
                    else:
                        yield encode_utf8(val)
                        yield '\n'
                yield '\n'
            yield '$$$$\n'

        logger.info('wrote %d', rownum+1)
    except Exception, e:
        logger.exception('SDF streaming error')
        raise


def cursor_generator(cursor, visible_fields, list_fields=None, value_templates=None):
    '''
    Yield the given cursor as a row of dicts:
    
    @param visible_fields fields to extract from the cursor
    @param list_fields fields to extract as list values
    @param value_templates

    '''
    logger.debug('visible: %r, list: %r, value templates: %r', 
        visible_fields, list_fields, value_templates)
    
    for row in cursor:
        
        output_row = []
    
        for key in visible_fields:
        
            value = None
            if row.has_key(key):
                value = row[key]
            else:
                logger.debug('no value for key: %r, %r', key, row)
            
            if value is not None and list_fields is not None \
                and key in list_fields:
            
                if isinstance(value, six.string_types):
                    # NOTE: filter empty strings; func.array_to_string inserts 
                    # a separator before every element, even if list has one value
                    value = list(filter(None,value.split(LIST_DELIMITER_SQL_ARRAY)))
            
            if value_templates and key in value_templates:
                
                value_template = value_templates[key]
                new_value = interpolate_value_template(value_template, row)
                if DEBUG_STREAMING: 
                    logger.info('field: %r, value: %r, new_value: %r, value_template: %r', 
                        key, value, new_value, value_template)
                value = new_value
        
            output_row.append(value)

        yield OrderedDict(zip(visible_fields,output_row))


def get_xls_response(
        data, output_filename,request=None,image_keys=None,
        title_function=None, list_brackets=None):
    '''
    Create an xlsx file that will be streamed through the StreamingHttpResponse.
    
    - if length exceeds MAX_ROWS_PER_XLS_FILE, create multiple files and zip them.
    - TODO: when using xlsx, can simply add extra sheets to the file.
    
    @param output_filename - for naming temp files
 
    TODO: wrap cursor with cursorgenerator; pass in the image columns as arg
    TODO: rework this using the generic_xlsx_response as a template:
    - this method is used for all xlsx serialization at this time, except 
    for in testing, and in ScreenResultSerializer - 20160419.
    '''

    if not isinstance(data, dict):
        raise ProgrammingError(
            'unknown data for xls serialization: %r, must be a dict of '
            'sheet_row entries' % type(data))
 
    # Create a temp dir to store multiple generated files
    temp_dir = os.path.join(
        settings.TEMP_FILE_DIR, str(time.clock()).replace('.', '_'))
    os.mkdir(temp_dir)
    
    try:
        # Create an new Excel file and add a worksheet.
        filename = '%s.xlsx' % (output_filename)
        temp_file = os.path.join(temp_dir, filename)
        file_names_to_zip = [temp_file]

        if DEBUG_STREAMING: 
            logger.info('temp file: %r', temp_file)

        workbook = xlsxwriter.Workbook(temp_file, {'constant_memory': True})
        
        for key, sheet_rows in data.items():
            
            # Determine if the source is a dict, a string, or an iterator
            
            if isinstance(sheet_rows, (dict, OrderedDict)):
            
                sheet_name = default_converter(key)
                logger.info('writing sheet %r...', sheet_name)
                sheet = workbook.add_worksheet(sheet_name)
                for i, row in enumerate(csvutils.dict_to_rows(sheet_rows)):
                    sheet.write_row(i,0,row)
            
            elif isinstance(sheet_rows, basestring):
                sheet_name = default_converter(key)
                logger.info('writing single string sheet %r...', sheet_name)
                sheet = workbook.add_worksheet(sheet_name)
                sheet.write_string(0,0,sheet_rows)
            
            else:
                # Sheet data is defined in an iterator or rows
                
                sheet_name = default_converter(key)
                logger.info('writing sheets for base name %r...', sheet_name)

                max_rows_per_sheet = 2**20
                sheet = workbook.add_worksheet(sheet_name)
                filerow = 0
                cumulative_filerows = 0
                sheets = 1
                
                for row,values in enumerate(sheet_rows):
                    
                    if filerow == 0:
                        for i,(key,val) in enumerate(values.items()):
                            title = key
                            if title_function:
                                title = title_function(key)
                            sheet.write_string(filerow,i,title)
                        filerow += 1
                    
                    for i, (key,val) in enumerate(values.items()):
                    
                        val = csvutils.convert_list_vals(
                            val, delimiter=LIST_DELIMITER_XLS,
                            list_brackets=list_brackets)
                        
                        if val is not None:
                            
                            if image_keys and key in image_keys:
                                max_rows_per_sheet = MAX_IMAGE_ROWS_PER_XLS_FILE
                                if not request:
                                    raise Exception(
                                        'must specify the request parameter for image export')
                                # Hack to speed things up for the db.api:
                                if ( key == 'structure_image' and
                                        'library_well_type' in values and
                                        values['library_well_type'].lower() == 'empty' ):
                                    continue
                                write_xls_image(sheet, filerow, i, val, request)
                            else:
                                if isinstance(val, numbers.Number):
                                    sheet.write_number(filerow, i, val)
                                else:
                                    if len(val) > 32767: 
                                        logger.error('warn, row too long, %d, key: %r, len: %d', 
                                            filerow,key,len(val) )
                                    sheet.write_string(filerow,i,val)
                    filerow += 1
                    if row % 10000 == 0:
                        logger.info('wrote %d rows to temp file', row)
                
                    if filerow >= max_rows_per_sheet:
                        cumulative_filerows += filerow
                        workbook.close()
                        logger.info('wrote file: %r', temp_file)
          
                        # Create an new Excel file and add a worksheet.
                        filename = '%s_%s.xlsx' % (output_filename, cumulative_filerows)
                        temp_file = os.path.join(temp_dir, filename)
                        workbook = xlsxwriter.Workbook(temp_file, {'constant_memory': True})
                        sheet = workbook.add_worksheet(sheet_name)
                        file_names_to_zip.append(temp_file)
                        filerow = 0
                        
                logger.info('wrote %d filerows to file: %r',filerow, temp_file)
                              
        workbook.close()
  
        content_type = '%s; charset=utf-8' % XLSX_MIMETYPE
        if len(file_names_to_zip) >1:
            content_type = '%s; charset=utf-8' % ZIP_MIMETYPE
            temp_file = os.path.join('/tmp',str(time.clock()))
            logger.info('temp ZIP file: %r', temp_file)
  
            with ZipFile(temp_file, 'w') as zip_file:
                for _file in file_names_to_zip:
                    zip_file.write(_file, os.path.basename(_file))
            logger.info('wrote file %r', temp_file)
            filename = '%s.zip' % output_filename
 
        _file = file(temp_file)
        logger.info('download tmp file: %r, %r',temp_file,_file)
        wrapper = FileWrapper(_file)
        response = StreamingHttpResponse(
            wrapper, content_type=content_type) 
        response['Content-Length'] = os.path.getsize(temp_file)
        response['Content-Disposition'] = \
            'attachment; filename=%s' % filename
        return response
    except Exception, e:
        logger.exception('xls streaming error')
        raise e   
    finally:
        try:
            logger.info('rmdir: %r', temp_dir)
            shutil.rmtree(temp_dir)
            if os.path.exists(temp_file):
                logger.info('remove: %r', temp_file)
                os.remove(temp_file)     
        except Exception, e:
            logger.exception('on xlsx & zip file process file: %s' % output_filename)
            raise

def get_xls_response_all_images_to_one_file(
        data, output_filename, request=None, image_keys=None,
        title_function=None, list_brackets=None):
    '''
    For testing only - see get_xls_response
    '''
    # using XlsxWriter for constant memory usage
    max_rows_per_sheet = 2**20

    # Open with delete=False; file will be closed and deleted 
    # by the FileWrapper1 instance when streaming is finished.
    with  NamedTemporaryFile(delete=False) as temp_file:

        logger.info('save to file; %r...', output_filename)
        xls_write_workbook(temp_file, data, request=request, 
            image_keys=image_keys, title_function=title_function, 
            list_brackets=list_brackets)
        logger.info('saved temp file for; %r', output_filename)
    
        temp_file.seek(0, os.SEEK_END)
        size = temp_file.tell()
        temp_file.seek(0)   

    logger.info('stream to response: file: %r...', output_filename)
    _file = file(temp_file.name)
    response = StreamingHttpResponse(FileWrapper1(_file)) 
    response['Content-Length'] = size
    response['Content-Type'] = XLSX_MIMETYPE
    response['Content-Disposition'] = \
        'attachment; filename=%s.xlsx' % output_filename
    return response


class FileWrapper1:
    '''
    Modified FileWrapper to delete file after iterating;
    (for use with temporary files).
    '''

    def __init__(self, filelike, delete_on_close=True, blksize=8192):
        
        self.filelike = filelike
        self.blksize = blksize
        self.delete_on_close = delete_on_close

    def __getitem__(self,key):
        
        data = self.filelike.read(self.blksize)
        if data:
            return data
        
        # Modified: delete file after iterating
        logger.info('Filewrapper iteration finished, delete temp file %r...',
            self.filelike.name)
        self.filelike.close()
        os.remove(self.filelike.name)

        raise IndexError

    def __iter__(self):
        return self

    def next(self):
       
        data = self.filelike.read(self.blksize)
        if data:
            return data
        
        # Modify: delete file after iterating
        logger.info('done writing to response...')
        self.filelike.close()
        
        if self.delete_on_close is True:
            logger.info('removing file %r', self.filelike.name)
            os.remove(self.filelike.name)
        
        raise StopIteration


def generic_xlsx_response(data):
    '''
    Write out a data dictionary:
    dict keys: named sheets
    values:
    - if dict, convert to rows using dict_to_rows
    - if list, write directly as sheet rows
    - otherwise write as string
    '''
    # using XlsxWriter for constant memory usage
    with  NamedTemporaryFile(delete=False) as temp_file:
        generic_xls_write_workbook(temp_file, data)
        temp_file.seek(0, os.SEEK_END)
        size = temp_file.tell()
        temp_file.seek(0)   
    logger.info('stream to response')
    _file = file(temp_file.name)
    response = StreamingHttpResponse(FileWrapper1(_file)) 
    response['Content-Length'] = size
    response['Content-Type'] = XLSX_MIMETYPE
    return response

# def zip_file_response(files, output_filename):
#     '''
#     Return a StreamingHttpResponse containing the zip file for the given files.
#     @param files to include in the zip response 
#     '''
#     # Open with delete=False; file will be closed and deleted 
#     # by the FileWrapper1 instance when streaming is finished.
#     with  NamedTemporaryFile(delete=False) as temp_file:
#         
#         with ZipFile(temp_file, 'w') as zip_file:
#             for _file in files:
#                 zip_file.write(_file, os.path.basename(_file))
#         logger.info('wrote file %r', temp_file)
#         logger.info('saved temp file for; %r', output_filename)
#     
#         temp_file.seek(0, os.SEEK_END)
#         size = temp_file.tell()
#         temp_file.seek(0)   
# 
# 
#     filename = '%s.zip' % output_filename
#     logger.info('download zip file: %r, %r',filename)
#     _file = file(temp_file.name)
#     response = StreamingHttpResponse(FileWrapper1(_file)) 
#     response['Content-Length'] = size
#     response['Content-Type'] = '%s; charset=utf-8' % ZIP_MIMETYPE
#     response['Content-Disposition'] = \
#         'attachment; filename=%s.xlsx' % output_filename
#     return response
# 
#     
#     wrapper = FileWrapper(_file)
#     response = StreamingHttpResponse(
#         wrapper, content_type='%s; charset=utf-8' % ZIP_MIMETYPE) 
#     response['Content-Length'] = os.path.getsize(temp_file)
#     response['Content-Disposition'] = \
#         'attachment; filename=%s' % filename
#     return response
    

