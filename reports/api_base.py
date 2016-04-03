from __future__ import unicode_literals

from functools import wraps
import logging
import re

from django.conf import settings
from django.core.cache import cache
from django.http.response import HttpResponseBase
from django.utils import timezone
from django.utils.cache import patch_cache_control, patch_vary_headers
from django.views.decorators.csrf import csrf_exempt
from tastypie.exceptions import ImmediateHttpResponse, BadRequest
from tastypie.http import HttpBadRequest, HttpNotImplemented, HttpNoContent
from tastypie.resources import Resource, convert_post_to_put, sanitize
from tastypie.utils.mime import build_content_type

from reports import HEADER_APILOG_COMMENT, ValidationError
from reports.models import ApiLog
from reports.serialize import XLSX_MIMETYPE, SDF_MIMETYPE, XLS_MIMETYPE, \
    CSV_MIMETYPE, JSON_MIMETYPE


logger = logging.getLogger(__name__)


def un_cache(_func):
    '''
    Wrapper function to disable caching for 
    SQLAlchemyResource.stream_response_from_statement and other caches
    ''' 
    @wraps(_func)
    def _inner(self, *args, **kwargs):
        logger.debug('decorator un_cache: %s, %s', self, _func )
        IccblBaseResource.clear_cache(self)
        IccblBaseResource.set_caching(self,False)
        result = _func(self, *args, **kwargs)
        IccblBaseResource.set_caching(self,True)
        logger.debug('decorator un_cache done: %s, %s', self, _func )
        return result

    return _inner


class IccblBaseResource(Resource):
    """
    Override tastypie.resources.Resource:
    -- use StreamingHttpResponse or the HttpResponse
    -- control application specific caching
    -- serialization cleanup
    """

    content_types = {
                     'xls': XLS_MIMETYPE,
                     'xlsx': XLSX_MIMETYPE,
                     'csv': CSV_MIMETYPE,
                     'sdf': SDF_MIMETYPE,
                     'json': JSON_MIMETYPE,
                     }

    def clear_cache(self):
        logger.debug('clearing the cache from resource: %s (all caches cleared)' 
            % self._meta.resource_name)
        cache.clear()

    def set_caching(self,use_cache):
        self.use_cache = use_cache

    def serialize(self, request, data, format, options=None):
        options = options or {}
        return self._meta.serializer.serialize(data, format, options)

    def deserialize(self, request, data, format='application/json'):
        deserialized = self._meta.serializer.deserialize(
            data, format=request.META.get('CONTENT_TYPE', 'application/json'))
        return deserialized

    def make_log(self, request, **kwargs):
        log = ApiLog()
        log.username = request.user.username 
        log.user_id = request.user.id 
        log.date_time = timezone.now()
        log.api_action = str((request.method)).upper()
 
        # TODO: how do we feel about passing form data in the headers?
        # TODO: abstract the form field name
        if HEADER_APILOG_COMMENT in request.META:
            log.comment = request.META[HEADER_APILOG_COMMENT]
     
        if kwargs:
            for key, value in kwargs.items():
                if hasattr(log, key):
                    setattr(log, key, value)
        return log

    def _get_filename(self,schema, kwargs):
        filekeys = []
        if 'id_attribute' in schema:
            filekeys.extend([ str(kwargs[key]) for 
                key in schema['id_attribute'] if key in kwargs ])
        else:
            _dict = {key:val for key,val in kwargs.items() 
                if key not in [
                    'visibilities','exact_fields','api_name','resource_name',
                    'includes','order_by']}
            for i,(x,y) in enumerate(_dict.items()):
                filekeys.append(str(x))
                filekeys.append(str(y))
                if i == 10:
                    break
                 
        filekeys.insert(0,self._meta.resource_name)
        logger.debug('filekeys: %r', filekeys)
        filename = '_'.join(filekeys)
        filename = re.sub(r'[\W]+','_',filename)
        logger.debug('get_filename: %r, %r' % (filename, kwargs))
        return filename
    
    def get_format(self, request, **kwargs):
        
        return self._meta.serializer.get_format(request,**kwargs)

    def wrap_view(self, view):
        """
        Override the tastypie implementation to handle our own ValidationErrors.
        
        Wraps methods so they can be called in a more functional way as well
        as handling exceptions better.

        Note that if ``BadRequest`` or an exception with a ``response`` attr
        are seen, there is special handling to either present a message back
        to the user or return the response traveling with the exception.
        """
        @csrf_exempt
        def wrapper(request, *args, **kwargs):
            try:
                callback = getattr(self, view)
                logger.info('callback: %r, %r', callback, view)
                response = callback(request, *args, **kwargs)
                # Our response can vary based on a number of factors, use
                # the cache class to determine what we should ``Vary`` on so
                # caches won't return the wrong (cached) version.
                varies = getattr(self._meta.cache, "varies", [])

                if varies:
                    patch_vary_headers(response, varies)

                if self._meta.cache.cacheable(request, response):
                    if self._meta.cache.cache_control():
                        # If the request is cacheable and we have a
                        # ``Cache-Control`` available then patch the header.
                        patch_cache_control(response, **self._meta.cache.cache_control())

                if request.is_ajax() and not response.has_header("Cache-Control"):
                    # IE excessively caches XMLHttpRequests, so we're disabling
                    # the browser cache here.
                    # See http://www.enhanceie.com/ie/bugs.asp for details.
                    patch_cache_control(response, no_cache=True)

                return response
            except (BadRequest) as e:
                data = {"error": sanitize(e.args[0]) if getattr(e, 'args') else ''}
                return self.error_response(request, data, response_class=HttpBadRequest)
            except ValidationError as e:
                logger.info('validation error: %r', e)
                # TODO: make this compatible with the 
                # django.core.exceptions.ValidationError
                # 20160419 - sde
                desired_format = self.get_format(request)
                try:
                    serialized = self.serialize(
                        request, { 'errors': e.errors }, desired_format)
                    response =  HttpBadRequest(
                        content=serialized, content_type=desired_format)
                    if desired_format in [XLSX_MIMETYPE, XLS_MIMETYPE]:
                        response['Content-Disposition'] = \
                            'attachment; filename=%s.xlsx' % 'errors'
                        downloadID = request.GET.get('downloadID', None)
                        if downloadID:
                            logger.info('set cookie "downloadID" %r', downloadID )
                            response.set_cookie('downloadID', downloadID)
                        else:
                            logger.debug('no downloadID: %s' % request.GET )
                    return response
                    
                except BadRequest as e:
                    error = "Additional errors occurred, but serialization of those errors failed."
                    if settings.DEBUG:
                        error += " %s" % e
                    return HttpBadRequest(content=error, content_type='text/plain')
        
                return HttpBadRequest(
                    content=serialized, 
                    content_type=build_content_type(desired_format))
            except Exception as e:
                if hasattr(e, 'response'):
                    return e.response

                # A real, non-expected exception.
                # Handle the case where the full traceback is more helpful
                # than the serialized error.
                if settings.DEBUG and getattr(settings, 'TASTYPIE_FULL_DEBUG', False):
                    raise

                # Re-raise the error to get a proper traceback when the error
                # happend during a test case
                if request.META.get('SERVER_NAME') == 'testserver':
                    raise

                # Rather than re-raising, we're going to things similar to
                # what Django does. The difference is returning a serialized
                # error message.
                return self._handle_500(request, e)

        return wrapper


    def dispatch(self, request_type, request, **kwargs):
        """
        Override tastypie.resources.Resource to replace check:
         if not isinstance(response, HttpResponse):
            return http.HttpNoContent()
        with:
         if not isinstance(response, HttpResponseBase):
            return http.HttpNoContent()
        -- this allows for use of the StreamingHttpResponse or the HttpResponse
        
        Other modifications:
        - use of the "downloadID" cookie
        """
        allowed_methods = getattr(
            self._meta, "%s_allowed_methods" % request_type, None)

        if 'HTTP_X_HTTP_METHOD_OVERRIDE' in request.META:
            request.method = request.META['HTTP_X_HTTP_METHOD_OVERRIDE']

        request_method = self.method_check(request, allowed=allowed_methods)
        method = getattr(self, "%s_%s" % (request_method, request_type), None)

        if method is None:
            raise ImmediateHttpResponse(response=HttpNotImplemented())

        self.is_authenticated(request)
        self.throttle_check(request)

        # All clear. Process the request.
        convert_post_to_put(request)
        logger.info('calling method: %r', "%s_%s" % (request_method, request_type))
        response = method(request, **kwargs)

        # Add the throttled request.
        self.log_throttled_access(request)

        # If what comes back isn't a ``HttpResponse``, assume that the
        # request was accepted and that some action occurred. This also
        # prevents Django from freaking out.
        if not isinstance(response, HttpResponseBase):
            return HttpNoContent()
        
        # Custom ICCB parameter: set cookie to tell the browser javascript
        # UI that the download request is finished
        downloadID = request.GET.get('downloadID', None)
        if downloadID:
            logger.info('set cookie "downloadID" %r', downloadID )
            response.set_cookie('downloadID', downloadID)
        else:
            logger.debug('no downloadID: %s' % request.GET )

        return response
       
