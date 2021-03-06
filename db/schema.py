from __future__ import unicode_literals 
''' Schema utils:

Define schema constants
- Field names used by the API and intended as constant over versions
- Vocabulary values used by the API and intended as constant over versions

Utilities for parsing the schema
 '''

import logging
from django.conf import settings

import reports.schema
from reports.schema import *

logger = logging.getLogger(__name__)

DB_API_URI = 'db/api/%s' % VERSION

class SCREEN(schema_obj):
    resource_name = 'screen'
    
    FACILITY_ID = 'facility_id'
    SCREEN_TYPE = 'screen_type'
    SCREEN_RESULT_AVAILABILITY = 'has_screen_result'
    STATUS = 'status'
    STATUS_DATE = 'status_date'
    STUDY_TYPE = 'study_type'
    TITLE = 'title'
    LEAD_SCREENER_ID = 'lead_screener_id'
    LAB_HEAD_ID = 'lab_head_id'
    COLLABORATORS_ID = 'collaborator_ids'
    LAB_NAME = 'lab_name'
    DATA_SHARING_LEVEL = 'data_sharing_level'
    DATA_PRIVACY_EXPIRATION_DATE = 'data_privacy_expiration_date'
    DATA_PRIVACY_EXPIRATION_NOTIFIED_DATE = 'data_privacy_expiration_notified_date'
    MIN_DATA_PRIVACY_EXPIRATION_DATE = 'min_allowed_data_privacy_expiration_date'
    MAX_DATA_PRIVACY_EXPIRATION_DATE = 'max_allowed_data_privacy_expiration_date'
    LAST_LIBRARY_SCREENING_DATE = 'date_of_last_library_screening'
    PUBLICATIONS = 'publications'
    PUBLICATION_IDS = 'publication_ids'
    
    # Virtual columns (calculated by API)
    OVERLAPPING_POSITIVE_SCREENS = 'overlapping_positive_screens'
    USER_ACCESS_LEVEL_GRANTED = 'user_access_level_granted'

class DATA_COLUMN(schema_obj):
    resource_name = 'datacolumn'
    
    NAME = 'name'
    DESCRIPTION = 'description'
    ASSAY_DATA_TYPE = 'assay_data_type'
    DATA_TYPE = 'data_type'
    DECIMAL_PLACES = 'decimal_places'
    REPLICATE_ORDINAL = 'replicate_ordinal'
    TIME_POINT = 'time_point'
    CHANNEL = 'channel'
    ZDEPTH_ORDINAL = 'zdepth_ordinal'
    ASSAY_READOUT_TYPE = 'assay_readout_type'
    DERIVED_FROM_COLUMNS = 'derived_from_columns'
    HOW_DERIVED = 'how_derived'
    IS_FOLLOW_UP_DATA = 'is_follow_up_data'
    IS_DERIVED = 'is_derived'
    ASSAY_PHENOTYPE = 'assay_phenotype'
    POSITIVES_COUNT = 'positives_count'
    STRONG_POSITIVES_COUNT = 'strong_positives_count'
    MEDIUM_POSITIVES_COUNT = 'medium_positives_count'
    WEAK__POSITIVES_COUNT = 'weak_positives_count'
    ORDINAL = 'ordinal'
    TIME_POINT_ORDINAL = 'time_point_ordinal'
    SCREEN_FACILITY_ID = 'screen_facility_id'
    COMMENTS = 'comments'
    TITLE = 'title'
    KEY = 'key'

    USER_ACCESS_LEVEL_GRANTED = 'user_access_level_granted'

class SCREEN_RESULT(schema_obj):
    resource_name = 'screenresult'
    
    WELL_ID = 'well_id'
    PLATE_NUMBER = 'plate_number'
    WELL_NAME = 'well_name'
    LIBRARY_SHORT_NAME = 'short_name'
    LIBRARY_WELL_TYPE = 'library_well_type'
    VENDOR_NAME = 'vendor_name'
    VENDOR_ID = 'vendor_identifier'
    ASSAY_CONTROL_TYPE = 'assay_well_control_type'
    SCREEN_FACILITY_ID = 'screen_facility_id'
    #     'screen_title'
    #     'mouseover'
    IS_POSITIVE = 'is_positive'
    CONFIRMED_POSITIVE_VALUE = 'confirmed_positive_value'
    EXCLUDE = 'exclude'

class LIBRARY(schema_obj):    
    resource_name = 'library'

    DATE_CREATED = 'date_created'
    SHORT_NAME = 'short_name'
    NAME = 'library_name'
    EXPERIMENTAL_WELL_COUNT = 'experimental_well_count'
    PROVIDER = 'provider'
    SCREEN_TYPE = 'screen_type'
    PLATE_SIZE = 'plate_size'
    SOLVENT = 'solvent'
    LIBRARY_TYPE = 'library_type'
    IS_POOL = 'is_pool'
    SCREENING_STATUS = 'screening_status'
    START_PLATE = 'start_plate'
    END_PLATE = 'end_plate'
    DESCRIPTION = 'description'
    VERSION_NUMBER = 'version_number'
    IS_RELEASED = 'is_released'
    PREVIEW_LOG_ID = 'preview_log_id'
    IS_ARCHIVED = 'is_archived'

class COPY(schema_obj):
    resource_name = 'librarycopy'
    
    COPY_NAME = 'copy_name'
    USAGE_TYPE = 'usage_type'
    COMMENTS = 'comments'
    LIBRARY_SHORT_NAME = 'library_short_name'
    SCREEN_TYPE = 'screen_type'

class PLATE(schema_obj):
    resource_name = 'librarycopyplate'
    
    PLATE_NUMBER = 'plate_number'
    COPY_NAME = 'copy_name'
    PLATE_TYPE = 'plate_type'
    STATUS = 'status'
    STATUS_DATE = 'status_date'
    STATUS_PERFORMED_BY = 'status_performed_by'
    STATUS_PERFORMED_BY_USERNAME = 'status_performed_by_username'
    IS_ACTIVE = 'is_active'
    
    ROOM = 'room'
    FREEZER = 'freezer'
    SHELF = 'shelf'
    BIN = 'bin'
    LOCATION = 'location'
    
    LIBRARY_SHORT_NAME = 'library_short_name'

    PLATE_RANGE_FORMAT = \
            '{library_short_name}:{copy_name}:{start_plate}-{end_plate}'
    PLATE_RANGE_SINGLE_PLATE_FORMAT = \
            '{library_short_name}:{copy_name}:{plate_number}'

class PLATE_LOCATION(schema_obj):
    resource = 'platelocation'
    
    ROOM = 'room'
    FREEZER = 'freezer'
    SHELF = 'shelf'
    BIN = 'bin'
    LOCATION = 'location'
    
class ACTIVITY(schema_obj):
    resource_name = 'activity'
    
    ACTIVITY_ID = 'activity_id'
    DATE_OF_ACTIVITY = 'date_of_activity'
    CLASSIFICATION = 'classification'
    TYPE = 'type'
    SCREEN_FACILITY_ID = 'screen_facility_id'
    SERVICED_USER_ID = 'serviced_user_id'
    SERVICED_USERNAME = 'serviced_username'
    PERFORMED_BY_USER_ID = 'performed_by_user_id'
    PERFORMED_BY_USERNAME = 'performed_by_username'
    COMMENTS = 'comments'
    
class LIBRARY_SCREENING(ACTIVITY):
    resource_name = 'library_screening'
    
    LIBRARY_PLATES_SCREENED = 'library_plates_screened'
    

class SCREENSAVER_USER(USER):
    resource_name = 'screensaveruser'
    
    SCREENSAVER_USER_ID = 'screensaver_user_id'

class USER_AGREEMENT(schema_obj):
    resource_name = 'useragreement'
    
    SCREENSAVER_USER_ID = 'screensaver_user_id'
    USERNAME = 'username'
    USER_EMAIL = 'user_email'
    USER_NAME = 'user_name'
    USER_FIRST_NAME = 'user_first_name'
    USER_LAST_NAME = 'user_last_name'
    TYPE = 'type'
    DATA_SHARING_LEVEL = 'data_sharing_level'
    STATUS = 'status'
    DATE_ACTIVE = 'date_active'
    DATE_EXPIRED = 'date_expired'
    DATE_NOTIFIED = 'date_notified'
    
class PUBLICATION(schema_obj):
    resource_name = 'publication'
    
    PUBLICATION_ID = 'publication_id'
    PUBMED_ID = 'pubmed_id'
    PUBMED_CENTRAL_ID = 'pubmed_central_id'
    AUTHORS = 'authors'
    TITLE = 'title'
    JOURNAL = 'journal'
    VOLUME = 'volume'
    YEAR_PUBLISHED = 'year_published'
    PAGES = 'pages'
    ATTACHED_FILE_ID = 'attached_file_id'
    ATTACHED_FILENAME = 'attached_filename'
    SCREEN_FACILITY_ID = 'screen_facility_id'

    @classmethod
    def format_publication(cls,pub):
        txt = ''
        val = pub.get(cls.AUTHORS)
        if val:
            txt += '%s ' % val
        val = pub.get(cls.YEAR_PUBLISHED)
        if val:
            txt += '(%s) ' % val
        val = pub.get(cls.TITLE)
        if val:
            if val[-1] != '.':
                val += '.'
            txt += '%s ' % val
        val = pub.get(cls.JOURNAL)
        if val:
            txt += '%s ' % val
        val = pub.get(cls.VOLUME)
        if val:
            txt += '%s, ' % val
        val = pub.get(cls.PAGES)
        if val:
            txt += '%s.' % val
            
        return txt    

class WELL(schema_obj):
    resource_name = 'well'
    
    WELL_ID_PATTERN_MSG = '[plate_number]:[well_name]'
    
    WELL_ID = 'well_id'
    PLATE_NUMBER = 'plate_number'
    WELL_NAME = 'well_name'
    LIBRARY_SHORT_NAME = 'library_short_name'
    LIBRARY_NAME = 'library_name'
    SCREEN_TYPE = 'screen_type'
    LIBRARY_WELL_TYPE = 'library_well_type'
    MG_ML_CONCENTRATION = 'mg_ml_concentration'
    MOLAR_CONCENTRATION = 'molar_concentration'
    IS_DEPRECATED = 'is_deprecated'
    DEPRECATION_REASON = 'deprecation_reason'

class REAGENT(schema_obj):
    resource_name = 'reagent'
    
    VENDOR_NAME = 'vendor_name'
    VENDOR_IDENTIFIER = 'vendor_identifier'
    VENDOR_BATCH_ID = 'vendor_batch_id'

class SMALL_MOLECULE_REAGENT(schema_obj):
    resource_name = 'smallmoleculereagent'
    
    SMILES = 'smiles'
    INCHI = 'inchi'
    MOLECULAR_FORMULA = 'molecular_formula'
    MOLECULAR_MASS = 'molecular_mass'
    MOLECULAR_WEIGHT = 'molecular_weight'
    COMPOUND_NAME = 'compound_name'
    PUBCHEM_CID = 'pubchem_cid'
    CHEMBANK_ID = 'chembank_id'
    CHEMBL_ID = 'chembl_id'
    IS_RESTRICTED_STRUCTURE = 'is_restricted_structure'
    MOLFILE = 'molfile'
    STRUCTURE_IMAGE = 'structure_image'

class SILENCING_REAGENT(schema_obj):
    resource_name = 'silencingreagent'
    
    SEQUENCE = 'sequence'
    ANTI_SENSE_SEQUENCE = 'anti_sense_sequence'
    VENDOR_GENE_NAME = 'vendor_gene_name'
    VENDOR_ENTREZGENE_ID = 'vendor_entrezgene_id'
    VENDOR_ENTREZGENE_SYMBOLS = 'vendor_entrezgene_symbols'
    VENDOR_GENBANK_ACC_NOS = 'vendor_genbank_accession_numbers'
    VENDOR_GENE_SPECIES = 'vendor_gene_species'
    FACILITY_GENE_NAME = 'facility_gene_name'
    FACILITY_ENTREZGENE_ID = 'facility_entrezgene_id'
    FACILITY_ENTREZGENE_SYMBOLS = 'facility_entrezgene_symbols'
    FACILITY_GENBANK_ACC_NOS = 'facility_genbank_accession_numbers'
    FACILITY_GENE_SPECIES = 'facility_gene_species'
    IS_RESTRICTED_SEQUENCE = 'is_restricted_sequence'
    DUPLEX_WELLS = 'duplex_wells'
    POOL_WELL = 'pool_well'
    SILENCING_REAGENT_TYPE = 'silencing_reagent_type'
    IS_POOL = 'is_pool'

class LAB_CHERRY_PICK(schema_obj):
    
    CPR_ID = 'cherry_pick_request_id'
    DEST_WELL = 'destination_well'
    DEST_PLATE_TYPE = 'destination_plate_type'
    LIBRARY_SHORT_NAME = 'library_short_name'
    LOCATION = 'location'
    PLATE_NUMBER = 'library_plate'
    SCREENER_WELL_ID = 'screener_well_id'
    SCREENER_LIBRARY_SHORT_NAME = 'screener_library_short_name'
    SELECTED = 'selected'
    SELECTED_COPY_NAME = 'selected_copy_name'
    SOURCE_COPY_NAME = 'source_copy_name'
    SOURCE_WELL_ID = 'source_well_id'
    SOURCE_WELL_NAME = 'source_well_name'
    SOURCE_COPYWELL_ID = 'source_copywell_id'
    SOURCE_PLATE_TYPE = 'source_plate_type'
    STATUS = 'status'

class VOCAB(reports.schema.VOCAB):
    ''' Define selected vocabulary constants used by the API.'''
    
    class activity(schema_obj):
        class classification(schema_obj):
            SCREENING = 'screening'
            TRAINING = 'training'
            AUTOMATION = 'automation'
            OTHER = 'other'
            
            SERVICE_CLASSIFICATIONS = [
                TRAINING, AUTOMATION, OTHER]
        
        class type(schema_obj):
            LIBRARY_SCREENING =  'library_screening'
            EXT_LIBRARY_SCREENING = 'ext_library_screening'
            CHERRY_PICK_TRANSFER = 'cp_transfer'
            CHERRY_PICK_SCREENING = 'cp_screening'
            
            SCREENING_TYPES = [
                LIBRARY_SCREENING, EXT_LIBRARY_SCREENING, 
                CHERRY_PICK_SCREENING, CHERRY_PICK_TRANSFER]
            
    class datacolumn(schema_obj):
        class data_type(schema_obj):
            BOOLEAN_POSITIVE = 'boolean_positive_indicator'
            BOOLEAN = 'boolean'
            CONFIRMED_POSITIVE = 'confirmed_positive_indicator'
            DECIMAL = 'decimal'
            PARTITIONED_POSITIVE = 'partition_positive_indicator'
            INTEGER = 'integer'
            NUMERIC = 'numeric'
            STRING = 'string'
            TEXT = 'text'
            
            numeric_types = (INTEGER, DECIMAL, NUMERIC)
            positive_types = (
                BOOLEAN_POSITIVE, CONFIRMED_POSITIVE, PARTITIONED_POSITIVE)
    
    class plate(schema_obj):
        class status(schema_obj):
            AVAILABLE = 'available'
            RETIRED = 'retired'
            DISCARDED = 'discarded'
            LOST = 'lost'
            GIVEN_AWAY = 'given_away'
            DISCARDED_VOL_XFER = 'discarded_volume_transferred'
            NOT_SPECIFIED = 'not_specified'
            NOT_CREATED = 'not_created'
            NOT_AVAILABLE = 'not_available'

            retired_statuses = [
                RETIRED, DISCARDED, LOST, GIVEN_AWAY, DISCARDED_VOL_XFER]

        class plate_type(schema_obj):
            ABGENE_384 = 'abgene_384'
            COSTAR_96 = 'costar_96'
            EPPENDORF_384 = 'eppendorf_384'
            EPPENDORF_96 = 'eppendorf_96'
            GENETIX_384 = 'genetix_384'
            MARSH_384 = 'marsh_384'
            NUNC_96 = 'nunc_96'
        
    class copy(schema_obj):
        class usage_type(schema_obj):
            LIBRARY_SCREENING_PLATES = 'library_screening_plates'
            CHERRY_PICK_SOURCE_PLATES = 'cherry_pick_source_plates'
            STOCK_PLATES = 'stock_plates'
            STOCK_PLATES_96 = '96_stock_plates'
            
    class resultvalue(schema_obj):
        class partitioned_positive(schema_obj):
            NP = 0
            W = 1
            M = 2
            S = 3
        class confirmed_positive(schema_obj):
            NT = 0
            I = 1
            FP = 2
            CP = 3
            
    class assaywell(schema_obj):

        class control_type(schema_obj):
            BUFFER = 'buffer'
            EMPTY = 'empty'
            EXPERIMENTAL = 'experimental'
            ASSAY_CONTROL = 'assay_control'
            ASSAY_POSITIVE_CONTROL = 'assay_positive_control'
            LIBRARY_CONTROL = 'library_control'
            OTHER = 'other'
    
    class library(schema_obj):
        class screening_status(schema_obj):
            ALLOWED = 'allowed'
            NOT_RECOMMENDED = 'not_recommended'
            NOT_ALLOWED = 'not_allowed'
            RETIRED = 'retired'
            REQUIRES_PERMISSION = 'requires_permission'
        
        class library_type(schema_obj):
            FRAGMENT = 'fragment'
            NATURAL_PRODUCTS = 'natural_products'
            ACADEMIC_COLLECTION = 'academic_collection'
            KNOWN_BIOACTIVES = 'known_bioactives'
            SIRNA = 'sirna'
            DISCRETE = 'discrete'
            MIRNA_MIMI = 'mirna_mimic'
            MIRNA_INHIBITOR = 'mirna_inhibitor'
            COMMERCIAL = 'commercial'
            OTHER = 'other'
            
            # Retired
            DOS = 'dos'
            NCI = 'nci'
            ANNOTATION = 'annotation'
            # NIH_MLP = 'nih_mlp' # TODO: not used in ICCB-L

    class screensaver_user(schema_obj):
        
        class classification(schema_obj):
            PRINCIPAL_INVESTIGATOR = 'principal_investigator'
            GRADUATE_STUDENT = 'graduate_student'
            ICCB_FELLOW = 'iccb_fellow'
            RESEARCH_ASSISTANT = 'research_assistant'
            POSTDOC = 'postdoc'
            STAFF = 'staff'
            OTHER = 'other'
            
    class screen(schema_obj):
        
        class screen_type(schema_obj):
            SMALL_MOLECULE = 'small_molecule'
            RNAI = 'rnai'
            
        # data_sharing_level = namedtuple('data_sharing_level', 
        #     ['SHARED','MUTUAL', 'MUTUAL_POSITIVES','PRIVATE'])\
        #     (0,1,2,3)
        class data_sharing_level(schema_obj):
            SHARED = 0
            MUTUAL = 1
            MUTUAL_POSITIVES = 2
            PRIVATE = 3
        class user_role(schema_obj):
            PRINCIPAL_INVESTIGATOR = 'principal_investigator'
            LEAD_SCREENER = 'lead_screener'
            COLLABORATOR = 'collaborator'
            
        class screen_result_availability(schema_obj):
            AVAILABLE = 1
            NOT_SHARED = 2
            NONE = 3
            
        class user_access_level_granted(schema_obj):
            '''
            LIMITED_ONLY - user has access only to fields designated as public
            OVERLAPPING_ONLY - user may access screen datacolumns that are
                overlapping, and only when viewing own screen results
            MUTUALLY_SHARED - user is mutually sharing with this screen and may
                view datacolums and data, but not positives summaries
            ALL - user may view all data for own screens and public screens
            '''
            LIMITED_ONLY = 0
            OVERLAPPING_ONLY = 1
            MUTUALLY_SHARED = 2
            ALL = 3
    
    class well(schema_obj):
        class library_well_type(schema_obj):
            UNDEFINED = 'undefined'
            EXPERIMENTAL = 'experimental'
            DMSO = 'dmso'
            LIBRARY_CONTROL = 'library_control'
            RNAI_BUFFER = 'rnai_buffer'
            EMPTY = 'empty' 
            
    class user_agreement(schema_obj):
        
        class type(schema_obj):
            SM = 'sm'
            RNAI = 'rnai'
        
        class status(schema_obj):
            ACTIVE = 'active'
            EXPIRED = 'expired'
            INACTIVE = 'inactive'

        class file_type(schema_obj):
            SMUA = 'iccb_l_small_molecule_user_agreement'
            RNAI = 'iccb_l_rnai_user_agreement'

    class lab_cherry_pick(schema_obj):

        class status(schema_obj):
        
            SELECTED = 'selected'
            NOT_SELECTED = 'not_selected'
            UNFULFILLED = 'unfulfilled'
            PLATED = 'plated'



