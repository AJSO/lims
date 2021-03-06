from __future__ import unicode_literals

from collections import OrderedDict
from functools import wraps
import hashlib
import json
import logging
import re
import urllib

from aldjemy.core import get_engine, get_tables
from django.conf import settings
from django.http.request import HttpRequest
from django.http.response import StreamingHttpResponse, HttpResponse, Http404
import six
from sqlalchemy import select, asc, text
import sqlalchemy
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import array
from sqlalchemy.sql import and_, or_, not_, func
from sqlalchemy.sql import asc, desc, alias, Alias
from sqlalchemy.sql.elements import literal_column
from sqlalchemy.sql.expression import column, join, cast
from sqlalchemy.sql.expression import nullsfirst, nullslast
from sqlalchemy.sql.functions import func
import sqlalchemy.sql.sqltypes

from reports import LIST_DELIMITER_SQL_ARRAY, LIST_DELIMITER_URL_PARAM, \
    LIST_BRACKETS, MAX_IMAGE_ROWS_PER_XLS_FILE, MAX_ROWS_PER_XLS_FILE, \
    HTTP_PARAM_RAW_LISTS, HTTP_PARAM_DATA_INTERCHANGE, HTTP_PARAM_USE_TITLES, \
    HTTP_PARAM_USE_VOCAB, BadRequestError
from reports.api_base import IccblBaseResource, un_cache
import reports.schema as SCHEMA
from reports.serialize import XLSX_MIMETYPE, SDF_MIMETYPE, XLS_MIMETYPE, \
    JSON_MIMETYPE, CSV_MIMETYPE, parse_val
from reports.serialize.streaming_serializers import sdf_generator, \
    json_generator, get_xls_response, csv_generator, ChunkIterWrapper, \
    cursor_generator, image_generator, closing_iterator_wrapper
from reports.serializers import LimsSerializer


logger = logging.getLogger(__name__)

DEBUG_FILTERS = False or logger.isEnabledFor(logging.DEBUG)
DEBUG_CACHE = False or logger.isEnabledFor(logging.DEBUG)
DEBUG_STREAMING = False or logger.isEnabledFor(logging.DEBUG)

FIELD = SCHEMA.FIELD

DATA_TYPE = SCHEMA.VOCAB.field.data_type
VISIBILITY = SCHEMA.VOCAB.field.visibility
FILTER_TYPE = SCHEMA.VOCAB.filter_type

def _concat(*args):
    '''
    Use as a replacement for sqlalchemy.sql.functions.concat
    - "concat" is not available in postgresql 8.4
    TODO: obsoleted for postgres 9.6
    '''
    return func.array_to_string(array([x for x in args]),'')
        
def _concat_with_sep(args=None,sep=None):
    '''
    Use as a replacement for sqlalchemy.sql.functions.concat
    - "concat" is not available in postgresql 8.4
    TODO: obsoleted for postgres 9.6
    '''
    new_args = []
    for arg in args:
        new_args.append(arg)
        new_args.append(sep)
    new_args = new_args[:-1]
    return _concat(*new_args)

class SqlAlchemyResource(IccblBaseResource):
    '''
    Mix in SQLAlchemy specific methods for API Resources:
    
    - Construct SQL using SQLAlchemy expressions
    - Parse API params to SQLAlchemy filter expressions
    - Cache query results for pagination
    - Stream query result rows to the HTTP response
    - Apply serialization formatting
    '''
    
    def __init__(self, *args, **kwargs):
        # store the Aldjemy tables in a "bridge" object, for legacy reasons
        self.bridge = get_tables()
        self.use_cache = True
        super(SqlAlchemyResource, self).__init__(*args, **kwargs)
    
    @classmethod
    def wrap_statement(cls, stmt, order_clauses, filter_expression):
        '''
        Wrap the statement with the given order and filter expressions:
        
        @param stmt - a sqlalchemy.sql.expression.join instance
        @param order_clauses - list of sqlalchemy.sql.expression.column
        @param filter_expression - sqlalchemy.whereclause
        '''
        if order_clauses:
            _alias = Alias(stmt)
            stmt = select([text('*')]).select_from(_alias)
            stmt = stmt.order_by(*order_clauses)
        if filter_expression is not None:
            logger.debug('filter_expression: %r' % filter_expression)
            if not order_clauses:
                _alias = Alias(stmt)
                stmt = select([text('*')]).select_from(_alias)
            stmt = stmt.where(filter_expression)

        count_stmt = select([func.count()]).select_from(stmt.alias())
        return (stmt,count_stmt)
    
    def get_visible_fields(self, 
        schema_fields, filter_fields, manual_field_includes,
        visibilities, exact_fields=None, order_params=None):
        '''
        Construct an ordered dict of schema fields that are visible, based on
        - the field["visibility"] of each field on the resource, or,
        - if the field is in the manual_field_includes
        - if the field is in the filter_fields
        - if the field key in another fields schema field['dependencies'] 
        
        NOTE: Authorization filters will remove "unauthorized" fields before
            this method is called.
            
        TODO: this method is not SqlAlchemy specific
        '''
        DEBUG_VISIBILITY = False or logger.isEnabledFor(logging.DEBUG)
        
        if exact_fields is None:
            exact_fields = []
        if order_params is None:
            order_params = []
        if visibilities is None:
            raise Exception('No visibilities specified')
        visibilities = set(visibilities)
        
        if DEBUG_VISIBILITY:
            logger.info(
                'visibilities: %r, order_params: %r, manual_field_includes: %r',
                visibilities, order_params, manual_field_includes)
            logger.info(
                'field_hash initial: %r, manual: %r, exact: %r', 
                schema_fields.keys(),manual_field_includes, exact_fields )
            logger.info('field visibility settings: %r', 
                [ str((key,field[FIELD.VISIBILITY])) 
                    for key,field in schema_fields.items()])
            logger.info('field access levels: %r', 
                [ str((key,field.get('data_access_level', None))) 
                    for key,field in schema_fields.items()])

        if exact_fields:
            temp = { key:field for key,field in schema_fields.items()
                if key in exact_fields or key in filter_fields 
                    or key in manual_field_includes }
        else:
            # Calculate the visible fields
            temp = {}
            for key,field in schema_fields.items():
                field_visibilities = set(field.get(FIELD.VISIBILITY,[]))
                is_visible = False
                if DEBUG_VISIBILITY is True:
                    logger.info('key: %r, visibility: %r', key, field_visibilities)
                if key in manual_field_includes:
                    is_visible = True
                    if DEBUG_VISIBILITY is True:
                        logger.info('key: %r, manual', key)
                elif VISIBILITY.NONE not in field_visibilities:
                    if '*' in manual_field_includes:
                        is_visible = True
                        if DEBUG_VISIBILITY is True:
                            logger.info('key: %r, *', key)
                    elif field_visibilities:
                        if field_visibilities & visibilities:
                            is_visible = True
                            if DEBUG_VISIBILITY is True:
                                logger.info('key: %r, visibilities: %r', 
                                    key, field_visibilities & visibilities)
                if '{}{}'.format(FILTER_TYPE.INVERTED,key) in manual_field_includes:
                    is_visible = False

                if DEBUG_VISIBILITY is True:
                    logger.info('key: %r, is_visible: %r', key, is_visible)
                
                if is_visible is True:
                    temp[key] = field
            
        # Include fields required by a visible field to construct its 
        # value_template or display_options
        dependency_fields = set()
        for field in temp.values():
    
            if field.get(FIELD.VALUE_TEMPLATE):
                dependency_fields.update(
                    re.findall(
                        r'{([a-zA-Z0-9_-]+)}', field[FIELD.VALUE_TEMPLATE]))
            if field.get(FIELD.DISPLAY_OPTIONS):
                dependency_fields.update(
                    re.findall(
                        r'{([a-zA-Z0-9_-]+)}', field[FIELD.DISPLAY_OPTIONS]))
            if field.get(FIELD.DEPENDENCIES):
                dependency_fields.update(field.get(FIELD.DEPENDENCIES))
        if DEBUG_VISIBILITY:
            logger.info('dependency_fields %s', dependency_fields)
        if dependency_fields:
            temp.update({ key:field 
                for key,field in schema_fields.items() 
                    if key in dependency_fields })
        
        # Include filter_fields
        if filter_fields:
            temp.update({ key:field 
                for key,field in schema_fields.items() 
                    if key in filter_fields })
        # Include order params
        if order_params:
            temp.update({ key:field 
                for key,field in schema_fields.items() 
                    if ( key in order_params 
                        or '{}{}'.format(FILTER_TYPE.INVERTED, key) in order_params) })
        
        field_hash = OrderedDict(sorted(temp.iteritems(), 
            key=lambda x: x[1].get(FIELD.ORDINAL,999))) 

        if DEBUG_VISIBILITY:
            logger.info('field_hash final: %s', field_hash.keys())
    
        if not field_hash:
            
            raise BadRequestError(
                key='field', msg='required')
                
        return field_hash
        

    def build_sqlalchemy_columns(
            self, fields, base_query_tables=None, custom_columns=None):
        '''
        Returns an ordered dict of sqlalchemy.sql.schema.Column objects, 
        associated with the sqlalchemy.sql.schema.Table definitions, bound to 
        the sqlalchemy.engine.Engine: 
        "Connects a Pool and Dialect together to provide a source of database 
        connectivity and behavior."
        
        @param fields - field definitions, from the resource schema
        @param bridge - a reports.utils.sqlalchemy_bridge.Bridge
        @param base_query_tables - if specified, the fields for these tables 
        will be available as part of the base query, so the column definitions
        become simpler, and do not need to be joined in. 
        @param manual_includes - columns to include even if the field 
        visibility is not set
        '''
        DEBUG_BUILD_COLUMNS = logger.isEnabledFor(logging.DEBUG)
        base_query_tables = base_query_tables or []
        custom_columns = custom_columns or []
        
        try:
            columns = OrderedDict()
            for field in fields:
                key = field['key']
                if key in custom_columns:
                    if DEBUG_BUILD_COLUMNS: 
                        logger.info(
                            'custom field: %r, %r', key,custom_columns[key])
                    columns[key] = custom_columns[key].label(key)
                    continue
                
                if DEBUG_BUILD_COLUMNS: 
                    logger.info('build column: %r, %r', field['key'], field)
                field_name = field.get('field', None)
                if not field_name:
                    field_name = field['key']
                
                field_table = field.get('table', None)
                
                if not field_table and DEBUG_BUILD_COLUMNS:
                    logger.info(
                        'field: %r, val: %r, skipping field because there is no '
                        '"field_table" value set',key,field)
                    continue
                if DEBUG_BUILD_COLUMNS: 
                    logger.info(
                        'field: %r, field_table: %r', field['key'], field_table)
                
                if field_table in base_query_tables:
                    # simple case: table.fields already selected in the base query:
                    # just need to specify them
                    if field_name in get_tables()[field_table].c:
                        col = get_tables()[field_table].c[field_name]
                    else:
                        raise Exception(
                            'field: %r, not found in table: %r'
                            % (field_name, field_table))
                    col = col.label(key)
                    columns[key] = col
                    
                # TODO: 20181214: remove this; favor custom linking to subtables
                # Note: used in reagent subclasses
                elif field.get('linked_field_value_field', None):
                    link_table = field['table']
                    link_table_def = get_tables()[link_table]
                    linked_field_parent = field['linked_field_parent']
                    link_field = linked_field_parent + '_id'
                    join_args = { 
                        'link_table': link_table, 'link_field': link_field,
                        'parent_table': linked_field_parent
                        }
                    
                    if field['linked_field_type'] != 'fields.ListField':
                        join_stmt = select([link_table_def.c[field_name]]).\
                            where(text('{link_table}.{link_field}='
                                    '{parent_table}.{link_field}'.format(**join_args)))
                        join_stmt = join_stmt.label(key)
                        columns[key] = join_stmt
                    elif field['linked_field_type'] == 'fields.ListField':
                        join_stmt = select([link_table_def.c[field_name]]).\
                            where(text('{link_table}.{link_field}='
                                    '{parent_table}.{link_field}'.format(**join_args)))
    
                        ordinal_field = field.get('ordinal_field', None)
                        if ordinal_field:
                            join_stmt = join_stmt.order_by(
                                link_table_def.c[ordinal_field])
                        join_stmt = join_stmt.alias('a')
                        stmt2 = select([func.array_to_string(
                                        func.array_agg(column(field_name)),
                                                       LIST_DELIMITER_SQL_ARRAY)])
                        stmt2 = stmt2.select_from(join_stmt).label(key)
                        columns[key] = stmt2
                    if DEBUG_BUILD_COLUMNS:
                        logger.info('built linked column: %s: %r', key, columns[key])
                else:
                    if DEBUG_BUILD_COLUMNS:        
                        logger.info(
                            'field is not in the base tables %r, nor in a linked field, '
                            'and is not custom: %s', base_query_tables, key)
            if DEBUG_BUILD_COLUMNS: 
                logger.info('columns: %r', columns.keys())
            return columns
        except Exception, e:
            logger.exception('on build sqlalchemy columns')
            raise e   

    @staticmethod
    def build_sqlalchemy_ordering(order_params, visible_fields):
        '''
        returns a scalar or list of ClauseElement objects which will comprise 
        the ORDER BY clause of the resulting select.
        @param order_params passed as list in the request.GET hash
        '''
        DEBUG_ORDERING = False or logger.isEnabledFor(logging.DEBUG)
        
        if DEBUG_ORDERING:
            logger.info('build sqlalchemy ordering: %s, visible fields: %s',
                order_params,visible_fields.keys())
        if order_params and isinstance(order_params, basestring):
            # standard, convert single valued list params
            order_params = [order_params]
        order_clauses = []
        for order_by in order_params:
            field_name = order_by
            order_clause = None
            if order_by.startswith(FILTER_TYPE.INVERTED):
                field_name = order_by[1:]
                order_clause = nullslast(desc(column(field_name)))
                field = visible_fields.get(field_name, None)
                if ( field and field[FIELD.DATA_TYPE] == DATA_TYPE.STRING
                    and field.get(FIELD.IS_ALPHANUMERIC, False) is True ):
                    # For string field ordering, double sort as numeric and text
                    # - if the field begins with a number, lower valued numbers
                    # should sort later than higher valued numbers. (alpha sort
                    # will sort on the first digit only).
                    order_clause = text(
                        "(substring({field_name}, '^[0-9]+'))::int desc nulls last " # cast to integer
                        ",substring({field_name}, '[^0-9_].*$')  desc nulls last"  # works as text
                        .format(field_name=field_name))
            else:
                order_clause = nullsfirst(asc(column(field_name)))
                field = visible_fields.get(field_name, None)
                if ( field and field[FIELD.DATA_TYPE] == DATA_TYPE.STRING
                    and field.get(FIELD.IS_ALPHANUMERIC, False) is True ):
                    order_clause = text(
                        "(substring({field_name}, '^[0-9]+'))::int nulls first"
                        ",substring({field_name}, '[^0-9_].*$') nulls first"
                        .format(field_name=field_name))
            if field_name in visible_fields:
                order_clauses.append(order_clause)
            else:
                logger.warn(
                    'order_by field %r not in visible fields, skipping: ', 
                    order_by)
        if DEBUG_ORDERING:
            logger.info('order_clauses %s',order_clauses)     
        return order_clauses
    
    @staticmethod
    def parse_filter_value(value, filter_type):
        if isinstance(value, six.string_types):
            value = urllib.unquote(value).decode('utf-8')
            if value:
                value = value.strip()
        if filter_type in (FILTER_TYPE.IN, FILTER_TYPE.RANGE) and len(value):
            if value and hasattr(value, '__iter__'):
                # value is already a list
                pass
            else:
                value = value.split(LIST_DELIMITER_URL_PARAM)
        return value

    @staticmethod
    def build_sqlalchemy_filters(schema, param_hash):
        '''
        Build the full SqlAlchemy filter expression for all filters and search:
        
        @param param_hash: a hash of filter data:
        - filters defined as filter_key, filter_value; combined using "AND"
        - nested "nested_search_data":
            - an array of hashes of filter_data, to be OR'd together
            - each hash consists of filter_key, filter_value
        @return (
            filter_expression - full combined SqlAlchemy search expression
            combined_filter_hash - field_key:filter expression
            readable_filter_hash - field_key:textual representation 
                of the filters in the combined_filter_hash
            )
        '''
        
        if DEBUG_FILTERS: 
            logger.info('build_sqlalchemy_filters: param_hash %s', param_hash)

        # Parse filters
        filter_expression = None
        
        (filter_hash, readable_filter_hash) = \
            SqlAlchemyResource.build_sqlalchemy_filter_hash(schema, param_hash)
        combined_filter_hash = filter_hash

        if len(filter_hash) > 0:
            filter_expression = and_(*filter_hash.values())
        
            if DEBUG_FILTERS: 
                logger.info('Initial filter hash: %r', filter_hash)
                compiled_stmt = str(filter_expression.compile(
                    dialect=postgresql.dialect(),
                    compile_kwargs={"literal_binds": True}))
                logger.info('Initial compiled filter expression %s', compiled_stmt)

        # Nested search filters:
        # Treat the "nested_search_data" as an array of filter hashes,
        # OR'd together, then AND'd with the regular filters (if any)
        nested_search_data = param_hash.get(SCHEMA.API_PARAM_NESTED_SEARCH, None)
        
        if nested_search_data:
        
            if DEBUG_FILTERS:
                logger.info('nested_search_data: %r', nested_search_data)
            
            if isinstance(nested_search_data, basestring):
                # Parse strings as JSON encoded search data
                nested_search_data = json.loads(nested_search_data)
            if isinstance(nested_search_data, dict):
                nested_search_data = [nested_search_data]
            if not isinstance(nested_search_data, (list,tuple)):
                raise Exception('nested_search_data must be a list of dicts')
            
            # Parse each of the nested filter hashes
            search_expressions = []
            for search_hash in nested_search_data:
            
                if DEBUG_FILTERS:
                    logger.info('nested search_hash: %s' % search_hash)
                
                (search_filter_hash,readable_search_filter_hash) = \
                    SqlAlchemyResource.\
                        build_sqlalchemy_filter_hash(schema,search_hash)

                if len(search_filter_hash) > 0:

                    search_expressions.append(and_(*search_filter_hash.values()))
                    
                    # Append search expressions for each field to a combined hash,
                    # used for informational purposes
                    for field,expression in search_filter_hash.items():
                        if DEBUG_FILTERS:
                            logger.debug('search filter to combine: %r, %r', 
                                field, expression)
                        if field in combined_filter_hash:
                            combined_filter_hash[field] = \
                                or_(combined_filter_hash[field], expression)
                        else:
                            combined_filter_hash[field] = expression
            
            # OR all of the nested search filter expressions,
            # AND the result with the regular search filters
            if len(search_expressions) > 0:
                if len(search_expressions) > 1:
                    search_expressions = or_(*search_expressions)
                else:
                    search_expressions = search_expressions[0]
                    
                if DEBUG_FILTERS: 
                    compiled_stmt = str(search_expressions.compile(
                        dialect=postgresql.dialect(),
                        compile_kwargs={"literal_binds": True}))
                    logger.info('search expressions %s', compiled_stmt)
                    
                if filter_expression is not None:
                    filter_expression = and_(
                        search_expressions,
                        filter_expression)
                else:
                    filter_expression = search_expressions
        
                readable_filter_hash['search'] = '_'.join(search_hash.keys())    
        
        if DEBUG_FILTERS: 
            logger.info('filter_fields: %s',combined_filter_hash.keys())
            logger.info('readable_filter_hash: %r', readable_filter_hash)
            if filter_expression is not None:
                compiled_stmt = str(filter_expression.compile(
                    dialect=postgresql.dialect(),
                    compile_kwargs={"literal_binds": True}))
                logger.info('compiled filter expression %s', compiled_stmt)
        
        return (filter_expression,combined_filter_hash, readable_filter_hash)
    
    @staticmethod
    def parse_filter(filter_expr):
        
        if DEBUG_FILTERS:
            logger.info('parse filter: %r', filter_expr)
        
        if FILTER_TYPE.LOOKUP_SEP not in filter_expr:
            # params without the lookup separator are treated as eq / exact
            field_name = filter_expr
            filter_type = FILTER_TYPE.EXACT
            if DEBUG_FILTERS:
                logger.info('interpret: %r as %r for %r', 
                    filter_expr, filter_type,field_name)
        else:
            filter_bits = filter_expr.split(FILTER_TYPE.LOOKUP_SEP)
            if len(filter_bits) != 2:
                logger.warn(
                    'filter expression %r must be of the form '
                    '"field_name__expression"' % filter_expr )
                return (None,None,None)
            field_name = filter_bits[0]
            filter_type = filter_bits[1]
        inverted = False
        if field_name and field_name[0] == FILTER_TYPE.INVERTED:
            inverted = True
            field_name = field_name[1:]
        if DEBUG_FILTERS:
            logger.info('build filter expr: field_name, %r, '
                'filter_type: %r', 
                field_name, filter_type)

        return (field_name, filter_type, inverted)
    
    @staticmethod
    def build_filter( 
        field_name, data_type, filter_type, inverted, value ):

        if DEBUG_FILTERS:
            logger.info('build filter: %r, %r, %r, %r, %r', 
                field_name, data_type, filter_type, inverted, value)
        
        expression = None
        col = column(field_name)
        if data_type in DATA_TYPE.NUMERIC_TYPES:
            col = cast(col, sqlalchemy.sql.sqltypes.Numeric)
        elif data_type == DATA_TYPE.BOOLEAN:
            if filter_type != FILTER_TYPE.IS_NULL:
                col = cast(
                    func.coalesce(col,False), sqlalchemy.sql.sqltypes.Boolean)
        if data_type == DATA_TYPE.STRING:
            col = cast(col, sqlalchemy.sql.sqltypes.Text)
        if filter_type in [FILTER_TYPE.EXACT, FILTER_TYPE.EQUAL]:
            if data_type == DATA_TYPE.STRING:
                value = str(value)
            expression = col == value
            if data_type == DATA_TYPE.LIST:
                expression = text(
                    "'%s'=any(string_to_array(%s,'%s'))" 
                        % (value, field_name, LIST_DELIMITER_SQL_ARRAY))
        elif filter_type == FILTER_TYPE.ABOUT:
            decimals = 0
            if '.' in value:
                decimals = len(value.split('.')[1])
            expression = func.round(col, decimals) == value
            if DEBUG_FILTERS:
                logger.info(
                    'create "about" expression for: %r, %r, decimals %r', 
                    field_name, value, decimals)
        elif filter_type in [FILTER_TYPE.CONTAINS, FILTER_TYPE.ICONTAINS]:
            value = str(value)
            if value.find('^') == 0:
                value = value[1:]
            else:
                value = '%' + value
            if value.find('$') == len(value)-1:
                value = value[:-1]
            else:
                value = value + '%'
            if filter_type == FILTER_TYPE.ICONTAINS:
                expression = col.ilike(value)
            else:
                expression = col.like(value)
                
        elif filter_type == FILTER_TYPE.LESS_THAN:
            expression = col < value
        elif filter_type == FILTER_TYPE.LESS_THAN_EQUAL:
            expression = col <= value
        elif filter_type == FILTER_TYPE.GREATER_THAN:
            expression = col > value
        elif filter_type == FILTER_TYPE.GREATER_THAN_EQUAL:
            expression = col >= value
        elif filter_type == FILTER_TYPE.IS_BLANK:
            if data_type == DATA_TYPE.STRING:
                col = func.trim(col)
            if value is False or str(value).lower() == 'false':
                expression = col != None
                if data_type in [DATA_TYPE.STRING, DATA_TYPE.LIST]:
                    expression = col != ''
            else:
                expression = col == None
                if data_type == DATA_TYPE.STRING:
                    expression = col == ''
        elif filter_type == FILTER_TYPE.IS_NULL:
            if value is False or str(value).lower() == 'false':
                expression = col != None
            else:
                expression = col == None
        elif filter_type == FILTER_TYPE.IN:
            if data_type == DATA_TYPE.LIST: 
                # NOTE: for the list type, interpret "in" as any of the
                # given values are in the field
                temp_expressions = []
                for _val in value:
                    temp_expressions.append(
                        col.ilike('%{value}%'.format(value=_val)))
                
                expression = or_(*temp_expressions)
            else:
                expression = col.in_(value)
        elif filter_type == FILTER_TYPE.NOT_EQUAL:
            if data_type == DATA_TYPE.STRING:
                value = str(value)
            expression = col != value
        elif filter_type == FILTER_TYPE.RANGE:
            if len(value) != 2:
                logger.error('field: %r, val: %r, '
                    'range expression must be list of length 2', 
                    field_name, value)
            else:
                expression = col.between(value[0], value[1], symmetric=True)
        else:
            logger.error(
                'field: %r, unknown filter type: %r for value: %r', 
                field_name, filter_type, value)
        if inverted:
            expression = not_(expression)
        return expression

    @staticmethod
    def build_sqlalchemy_filter_hash(schema, param_hash):
        '''
        Create a SqlAlchemy where clause out of filter parameters of the form:
        
        field_name__filter_type:value
        
        @return (
            filter_hash of field_key:filter expression for the AND clause,
            readable_filter_hash - field_key:textual representation 
                of the filters in the combined_filter_hash )
        '''
        logger.debug('build_sqlalchemy_filter_hash %r' % param_hash)

        if param_hash is None:
            return (None,None)
        
        if not isinstance(param_hash, dict):
            raise Exception('filter hash must be a dict: %r', param_hash)
        
        fields = schema[SCHEMA.RESOURCE.FIELDS]
        filter_hash = {}
        readable_filter_hash = {}
        for filter_expr, value in param_hash.items():
            
            (field_name, filter_type, inverted) = \
                SqlAlchemyResource.parse_filter(filter_expr)

            if not field_name in fields:
                logger.debug('unknown filter field: %r, %r', 
                    field_name, filter_expr)
                continue
            field = fields[field_name]
            value = SqlAlchemyResource.parse_filter_value(value, filter_type)
            
            expression = SqlAlchemyResource.build_filter(
                field_name, field[FIELD.DATA_TYPE], filter_type, inverted, value)
            if expression is not None:

                filter_hash[field_name] = expression
                
                readable_expression = []
                if field_name in filter_expr:
                    if inverted is True:
                        readable_expression.append('not')
                    if filter_type not in (FILTER_TYPE.EQUAL, FILTER_TYPE.EXACT):
                        readable_expression.append(filter_type)
                readable_value = value
                if isinstance(readable_value,(list,tuple)):
                    readable_value = '_'.join([str(x) for x in readable_value]) 
                readable_expression.append(str(readable_value))
                readable_filter_hash[field_name] = '_'.join(readable_expression)
        
        if DEBUG_FILTERS:
            logger.info('filtered_fields: %s', filter_hash.keys())
            logger.info('readable_filter_hash: %r', readable_filter_hash)

        return (filter_hash, readable_filter_hash)

    def _cached_resultproxy(self, conn, stmt, count_stmt, param_hash, limit, offset):
        ''' 
        Cache for resultsets:
        - Always returns the cache object with a resultset, either from the cache,
        or executed herein.
        
        NOTE: limit and offset are included because this version of sqlalchemy
        does not support printing of them with the select.compile() function.
        
        '''
        # Limit check removed with the use of "use_caching" flag
        # if limit == 0:
        #    raise Exception('limit for caching must be >0')
        
        max_cache_count = settings.MAX_ROWS_FOR_CACHE_RESULTPROXY
        prefetch_number = 5
        if limit <= 1:
            prefetch_number = 1
        
        # Create the cache key:
        # Use a hexdigest because statements can contain problematic chars 
        # for locmemcache and to limit key size.
        compiled_stmt = str(stmt.compile(
            dialect=postgresql.dialect(), 
            compile_kwargs={"literal_binds": True}))
        if 'limit' in compiled_stmt.lower():
            # remove limit and offset; will calculate
            compiled_stmt = \
                compiled_stmt[:compiled_stmt.lower().rfind('limit')]
        if DEBUG_CACHE:
            logger.info('compiled_stmt for hash key: %s', compiled_stmt)
        key_digest = '%s_%s_%s' %(compiled_stmt, str(limit), str(offset))
        m = hashlib.md5()
        m.update(key_digest)
        key = m.hexdigest()
        if DEBUG_CACHE:
            logger.info('hash key: digest: %s, key: %s, limit: %s, offset: %s', 
                key_digest, key, limit, offset)

        cache_hit = self.get_cache().get(key)
        if cache_hit is not None:
            if ('stmt' not in cache_hit or
                    cache_hit['stmt'] != compiled_stmt):
                cache_hit = None
                logger.warn('cache collision for key: %r, %r', key, stmt)
        
        if cache_hit is None:
        
            if DEBUG_CACHE:
                logger.info('no cache hit for key: %r, executing stmt', key)
            
            # Note: if no cache hit, then retrive limit*n results, and 
            # cache several iterations at once.
            new_limit = limit * prefetch_number
            if new_limit > max_cache_count:
                if limit >= max_cache_count:
                    new_limit = max_cache_count
                else:
                    new_limit = (max_cache_count/limit) * limit
            if DEBUG_CACHE:
                logger.info(
                    'no cache hit, create cache, limit: %s, '
                    'new limit for caching: %s',
                    limit, new_limit)
            if new_limit > 0:
                stmt = stmt.limit(new_limit)
            
            resultset = conn.execute(stmt)
            prefetched_result = [
                dict(row) for row in resultset] if resultset else []
            
            if DEBUG_CACHE:
                logger.info('executed stmt %d', len(prefetched_result))
            
            if len(prefetched_result) < new_limit and offset == 0:
                # Optimize, skip count if first page and less than limit are found.
                count = len(prefetched_result)
            else:
                if DEBUG_CACHE:
                    logger.info('no cache hit, execute count')
                if limit == 1:
                    if DEBUG_CACHE:
                        logger.info('set count to 1, detail view')
                    count = 1
                else:
                    count = conn.execute(count_stmt).scalar()
            
            if limit==0 and count > settings.MAX_ROWS_FOR_CACHE_RESULTPROXY:
                logger.warn('too many rows to cache: %r, limit: %r, '
                    'see setting"MAX_ROWS_FOR_CACHE_RESULTPROXY"',
                    count, settings.MAX_ROWS_FOR_CACHE_RESULTPROXY)
                return None
            
            # Fill in the cache with the prefetched sets or rows
            cached_count = 0
            for y in range(prefetch_number):
            
                new_offset = offset + limit*y;
                _start = limit*y
                
                if DEBUG_CACHE:
                    logger.info('new_offset: %d, start: %d, len: %d', 
                        new_offset, _start, len(prefetched_result))
                
                if _start < len(prefetched_result):
                    # Create a more specific cache key for the exact number of rows
                    
                    key_digest = '%s_%s_%s' %(
                        compiled_stmt, str(limit), str(new_offset))
                    m = hashlib.md5()
                    m.update(key_digest)
                    key = m.hexdigest()
                    rows_to_fetch = limit
                    if limit==0:
                        rows_to_fetch = count+1
                    _result = prefetched_result[_start:_start+rows_to_fetch]
                    _cache = {
                        'stmt': compiled_stmt,
                        'cached_result': _result,
                        'count': count,
                        'key': key }
                    if DEBUG_CACHE:
                        logger.info(
                            'add to cache, key: %s, limit: %s, offset: %s',
                            key, limit, new_offset)
                    self.get_cache().set( key, _cache, None)
                    if y == 0:
                        cache_hit = _cache
                    cached_count += 1
                else:
                    if DEBUG_CACHE:
                        logger.info(
                            'not caching for block %d, total prefetched length: '
                            '%d, is less than block start: %d',
                            y+1,len(prefetched_result), _start)
                    break
            if DEBUG_CACHE:
                logger.info('store cached iterations: %s', cached_count)
        else:
            if DEBUG_CACHE:
                logger.info('cache hit for key: %r', key)   
            
        return cache_hit
 
    def stream_response_from_statement(self, 
            request, stmt, count_stmt, output_filename, field_hash, param_hash, 
            rowproxy_generator=None, is_for_detail=False,
            downloadID=None, title_function=None, use_caching=None, meta=None,
            format=None ):
        '''
        Execute the SQL stmt provided and stream the results to the response:
        
        Caching (for json responses only): resources will be cached if:
        - self.use_caching is True, use_caching is not False, and limit > 0, or,
        - limit == 0 and use_caching is True
        
        '''
        
        debug_param_hash = param_hash.copy()
        if 'schema' in debug_param_hash:
            del debug_param_hash['schema']
        if DEBUG_STREAMING:
            logger.info('stream_response_from_statement: %r, %r', 
                self._meta.resource_name,debug_param_hash)
        
        limit = param_hash.get('limit', 25)        
        try:
            limit = int(limit)
        except Exception:
            raise BadRequestError({
                'limit': 'Please provide a positive integer: %r' % limit})
        if limit > 0:    
            stmt = stmt.limit(limit)
        if is_for_detail:
            limit = 1

        offset = param_hash.get('offset', 0 )
        try:
            offset = int(offset)
        except Exception:
            raise BadRequestError({
                'offset': 'Please provide a positive integer: %r' % offset })
        if offset < 0:    
            offset = -offset
        stmt = stmt.offset(offset)
        
        conn = get_engine().connect()
        
        if DEBUG_STREAMING:
            logger.info('offset: %s, limit: %s', offset, limit)
            logger.info('stmt: %s, param_hash: %s ', 
                str(stmt.compile(
                        dialect=postgresql.dialect(), 
                        compile_kwargs={"literal_binds": True})), 
                debug_param_hash)
            logger.info(
                'count stmt %s', 
                str(count_stmt.compile(
                    dialect=postgresql.dialect(), 
                    compile_kwargs={"literal_binds": True})))
       
        if format is not None:
            content_type = \
            self.get_serializer().get_content_type_for_format(format)
        else:
            content_type = \
            self.get_serializer().get_accept_content_type(request)

        result = None
        if content_type == JSON_MIMETYPE:
            # Check cache
            # Create response "meta" counts
            
            if DEBUG_STREAMING:
                logger.info(
                    'streaming json, use_caching: %r, self.use_cache: %r, '
                    'limit: %d, %r', 
                    use_caching, self.use_cache, limit, is_for_detail)
            if ((self.use_cache is True and use_caching is not False)
                    and ( use_caching is True or limit > 0)
                    and is_for_detail is not True):
                cache_hit = self._cached_resultproxy(
                    conn, stmt, count_stmt, param_hash, limit, offset)
                if cache_hit:
                    result = cache_hit['cached_result']
                    count = cache_hit['count']
                else:
                    # cache routine should always return a cache object
                    logger.info('cache not set: execute stmt')
                    count = conn.execute(count_stmt).scalar()
                    result = conn.execute(stmt)
                logger.info('====count: %d, limit: %d ====', count, limit)
                
            else:
                if DEBUG_STREAMING:
                    logger.info('not cached, execute count stmt...')
                # compiled_stmt = str(count_stmt.compile(
                #     dialect=postgresql.dialect(),
                #     compile_kwargs={"literal_binds": True}))
                # logger.info('compiled count stmt: %s', compiled_stmt)
                
                count = conn.execute(count_stmt).scalar()
                if DEBUG_STREAMING:
                    logger.info('excuted count stmt: %d', count)
                result = conn.execute(stmt)
                if DEBUG_STREAMING:
                    logger.info('excuted stmt')

            if not meta:
                meta = {
                    'limit': limit,
                    'offset': offset,
                    'total_count': count
                    }
            else:
                temp = {
                    'limit': limit,
                    'offset': offset,
                    'total_count': count
                    }
                temp.update(meta)    
                meta = temp
            
            if rowproxy_generator:
                result = rowproxy_generator(result)
                
            if DEBUG_STREAMING:
                logger.info('is for detail: %r, count: %r', is_for_detail, count)
            if is_for_detail and count == 0:
                logger.info('detail not found')
                conn.close()
                return HttpResponse(status=404)
            
            if DEBUG_STREAMING:
                logger.info('json setup done, s: %r', meta)

        else: # not json
        
            logger.info('excute stmt')
            result = conn.execute(stmt)
            logger.info('excuted stmt')
            
            if rowproxy_generator:
                result = rowproxy_generator(result)
        
        result = closing_iterator_wrapper(result, conn.close)
        return self.stream_response_from_cursor(
            request, result, output_filename, field_hash, param_hash, 
            is_for_detail=is_for_detail, 
            downloadID=downloadID, 
            title_function=title_function, 
            meta=meta, format=format)
    
    def stream_response_from_cursor(
            self, request, result, output_filename, field_hash, param_hash,
            is_for_detail=False, downloadID=None, title_function=None, 
            meta=None, format=None):
        '''
        Stream the given result (SQLAlchemy cursor) to the response
        
        @param result a SQLAlchemy cursor
        '''
          
        list_brackets = LIST_BRACKETS
        if ( param_hash.get(HTTP_PARAM_DATA_INTERCHANGE, False)
            or request.GET.get(HTTP_PARAM_RAW_LISTS, False)):
            list_brackets = None

        if format is not None:
            content_type = \
                self.get_serializer().get_content_type_for_format(format)
        else:
            content_type = \
                self.get_serializer().get_accept_content_type(request)
        
        image_keys = [key for key,field in field_hash.items()
            if field.get(FIELD.DISPLAY_TYPE, None) == 'image']
        ordered_keys = sorted(field_hash.keys(), 
            key=lambda x: field_hash[x].get(FIELD.ORDINAL,key))
        list_fields = [ key for (key,field) in field_hash.items() 
            if( field.get('json_field_type',None) == 'fields.ListField' 
                or field.get('linked_field_type',None) == 'fields.ListField'
                or field.get(FIELD.DATA_TYPE) == DATA_TYPE.LIST ) ]
        value_templates = {key:field[FIELD.VALUE_TEMPLATE] 
            for key,field in field_hash.items() 
                if field.get(FIELD.VALUE_TEMPLATE)}
        logger.debug('list fields: %r', list_fields)
        data = cursor_generator(
            result,ordered_keys,list_fields=list_fields,
            value_templates=value_templates)
        response = None
        if content_type == JSON_MIMETYPE:
            response = StreamingHttpResponse(
                ChunkIterWrapper(
                    json_generator(
                        image_generator(data, image_keys, request), 
                        meta, is_for_detail=is_for_detail)))
            response['Content-Type'] = content_type
        
        elif( content_type == XLS_MIMETYPE or
            content_type == XLSX_MIMETYPE ): 

            data = {
                'data': data 
            }
            response = get_xls_response(
                data, output_filename, request=request, 
                title_function=title_function, image_keys=image_keys,
                list_brackets=list_brackets)

        elif content_type == SDF_MIMETYPE:
            
            response = StreamingHttpResponse(
                ChunkIterWrapper(
                    sdf_generator(
                        image_generator(data,image_keys, request), 
                        title_function=title_function)),
                content_type=content_type)
            response['Content-Disposition'] = \
                'attachment; filename=%s.sdf' % output_filename
        
        elif content_type == CSV_MIMETYPE:
            response = StreamingHttpResponse(
                ChunkIterWrapper(
                    csv_generator(
                        image_generator(data, image_keys, request), 
                        title_function=title_function, 
                        list_brackets=list_brackets)),
                content_type=content_type)
            response['Content-Disposition'] = \
                'attachment; filename=%s.csv' % output_filename
        else:
            raise BadRequestError({
                'content_type': 'unknown content_type: %r' % content_type })
        return response

