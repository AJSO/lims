##############################################################################
# Command line background job processing utility:
# - services a background job from the command line using the 
# reports.utils.background_processor.BackgroundClient
# - the BackgroundClient will utilize the Django server in "headless" mode
# to perform API requests.
##############################################################################

import argparse
import datetime
import logging
import os.path
import subprocess

import django
from django.conf import settings

from reports.utils import parse_credentials
import reports.utils.background_processor
from reports import InformationError


logger = logging.getLogger(__name__)


def execute_from_python(job_id, sbatch=False):
    '''
    Utility method to invoke from the running server.
    
    @see settings.BACKGROUND_PROCESSOR
    
    @param sbatch if true, requires "sbatch_settings" in the 
    BACKGROUND_PROCESSOR settings
    '''
    
    job_output_dir = settings.BACKGROUND_PROCESSOR['job_output_directory']
    if not os.path.exists(job_output_dir):
        os.makedirs(job_output_dir)
    credential_file = settings.BACKGROUND_PROCESSOR['credential_file']
    python_environ_script = settings.BACKGROUND_PROCESSOR['python_environ_script']
    logger.info('python run script: %r', python_environ_script)

    output_stdout = '%d.stdout'%job_id
    output_stdout = os.path.abspath(os.path.join(job_output_dir,output_stdout))
    output_stderr = '%d.stderr'%job_id
    output_stderr = os.path.abspath(os.path.join(job_output_dir,output_stderr))

    run_sh_args = [
        python_environ_script, 'python', 'reports/utils/background_client_util.py', 
        '--job_id', str(job_id), '--c', credential_file, '-vv']
    full_args = []
    
    if sbatch is True:
        full_args = full_args.append('sbatch')

        sbatch_settings = settings.BACKGROUND_PROCESSOR.get('sbatch_settings')
        if sbatch_settings is None:
            raise InformationError(
                key='sbatch_settings', 
                msg='missing from the BACKGROUND_PROCESSOR settings')
        
        sbatch_settings['output'] = output_stdout
        sbatch_settings['error'] = output_stderr
        sbatch_settings['job-name'] = 'ss_{}'.format(job_id)
        sbatch_args = []
        for k,v in sbatch_settings.items():
            sbatch_args.extend(['--%s'%k, '%s'%str(v)])
        full_args.extend(sbatch_args)

    full_args.extend(run_sh_args)
    
    logger.info('full args: %r', full_args)
    
    if sbatch is True:
        logger.info('sbatch specified, invoke sbatch and wait for output...')
        output = \
            subprocess.check_output(full_args, stderr=subprocess.STDOUT)
        logger.info('ran, output: %r', output)
        # TODO: parse the SLURM process ID from the output
        return output
    else:
        logger.info('sbatch not specified, run directly in the shell, asynchronously')
        # NOTE for testing only
        # NOTE: for async run, pipe the stdout/error to file, use shell=True
        full_args.append('>%s'%output_stdout)    
        full_args.append('2>%s'%output_stderr)
        full_args = ' '.join(full_args)    
        logger.info('full_args: %r', full_args)
        subprocess.Popen(full_args, shell=True)
        logger.info('ran async')
        return None
   

parser = argparse.ArgumentParser(description=
    'background_client_util: '
    'Service a pending background job from the command line using the ' 
    'reports.utils.background_processor.BackgroundClient '
    'to access the Django server in "headless" mode to perform API requests. '
    'NOTE: requires a valid DJANGO_SETTINGS_MODULE in the environment.')

# Admin credentials
parser.add_argument(
    '-U', '--username',
    help='username for the api authentication')
parser.add_argument(
    '-p', '--password',
    help='user password for the api authentication')
parser.add_argument(
    '-c', '--credential_file',
    help='credential file containing the username:password for api '
    'authentication')

parser.add_argument(
    '-j', '--job_id', required=True, type=int, 
    help='Job ID to process')

parser.add_argument(
    '-v', '--verbose', dest='verbose', action='count',
    help="Increase verbosity (specify multiple times for more)")    
    
        
if __name__ == "__main__":
    args = parser.parse_args()
    log_level = logging.WARNING # default
    if args.verbose == 1:
        log_level = logging.INFO
    elif args.verbose >= 2:
        log_level = logging.DEBUG
        DEBUG=True
    logging.basicConfig(
        level=log_level, 
        format='%(msecs)d:%(module)s:%(lineno)d:%(levelname)s: %(message)s')        

    if args.credential_file:
        username,password = parse_credentials(args.credential_file)
    if username is None:
        username = args.username
        if username is None:
            parser.error(
                'username is required if not specifying the credential_file')
        password = args.password
        if not password:
            password = getpass.getpass()

    print 'Process the background job', args.job_id
    try:
        django.setup()
        
        api_client = reports.utils.background_processor.ApiClient(username, password)
        background_client = \
            reports.utils.background_processor.BackgroundClient(api_client)
        response = background_client.service(args.job_id)    
            
    except Exception, e:
        logger.exception('in background service method')
        raise e
    print 'exit background processing service', datetime.datetime.now()
    