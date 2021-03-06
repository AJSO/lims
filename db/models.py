from __future__ import unicode_literals

import datetime
import logging
import re

from django.conf import settings
from django.db import connection
from django.db import models
from django.utils import timezone
from django.utils.encoding import python_2_unicode_compatible

from db.support import lims_utils
from reports import ValidationError


logger = logging.getLogger(__name__)


class Activity(models.Model):
    '''
    Activity tracks Service and Lab Activities performed for screeners.
    '''
     
    activity_id = models.AutoField(primary_key=True) 
    date_created = models.DateTimeField(default=timezone.now)
    comments = models.TextField(null=True)
    performed_by = models.ForeignKey(
        'ScreensaverUser', related_name='activities_performed',
        on_delete=models.CASCADE)
    date_of_activity = models.DateField()
    created_by = models.ForeignKey(
        'ScreensaverUser', null=True, 
        related_name='activities_created',
        on_delete=models.CASCADE)
    date_loaded = models.DateTimeField(null=True)
    date_publicly_available = models.DateTimeField(null=True)

    screen = models.ForeignKey('Screen', related_name='activities', null=True,
        on_delete=models.deletion.CASCADE)
    serviced_user = models.ForeignKey(
        'ScreensaverUser', null=True, on_delete=models.CASCADE)
    funding_support = models.TextField(null=True)
    classification = models.TextField(null=False)
    type = models.TextField(null=False)
    
    apilog_uri = models.TextField(null=True)
 
    class Meta:
        db_table = 'activity'
 
    def __repr__(self):
        return ('<Activity(activity_id=%r, performed_by=%r)>' 
            % (self.activity_id, self.performed_by))

class LabActivity(Activity):

    activitylink = models.OneToOneField(
        Activity, primary_key=True, parent_link=True, on_delete=models.CASCADE,
        db_column='activity_id')
    # screen = models.ForeignKey('Screen', on_delete=models.CASCADE)
    volume_transferred_per_well_from_library_plates = models.DecimalField(
        null=True, max_digits=10, decimal_places=9)
    molar_concentration = models.DecimalField(
        null=True, max_digits=13, decimal_places=12)
    
    class Meta:
        db_table = 'lab_activity'

    def __repr__(self):
        return (
            '<LabActivity(activity_id=%r, performed_by=%r, '
            'screen=%r, volume=%r)>' 
            % (self.activity_id, self.performed_by, self.screen,
                self.volume_transferred_per_well_from_library_plates))

class Screening(LabActivity):
    
    labactivitylink = models.OneToOneField(
        LabActivity, primary_key=True, parent_link=True, 
        on_delete=models.CASCADE, db_column='activity_id')
    assay_protocol = models.TextField()
    number_of_replicates = models.IntegerField(null=True)
    assay_protocol_type = models.TextField()
    assay_well_volume = models.DecimalField(
        null=True, max_digits=10, decimal_places=9)
    volume_transferred_per_well_to_assay_plates = \
        models.DecimalField(null=True, max_digits=10, decimal_places=9)
    assay_protocol_last_modified_date = models.DateField(null=True)
    
    class Meta:
        db_table = 'screening'

    def __repr__(self):
        return (
            '<Screening(activity_id=%r, performed_by=%r, '
            'screen=%r, volume=%r)>' 
            % (self.activity_id, self.performed_by, self.screen.facility_id,
                self.volume_transferred_per_well_from_library_plates))


class LibraryScreening(Screening):
    
    screeninglink = models.OneToOneField(
        'Screening', primary_key=True, parent_link=True, 
        on_delete=models.CASCADE, db_column='activity_id')
    abase_testset_id = models.TextField()
    is_for_external_library_plates = models.BooleanField(default=False)

    screened_experimental_well_count = models.IntegerField(default=0)

    # Deprecated: calculated on the fly
    libraries_screened_count = models.IntegerField(null=True)
    library_plates_screened_count = models.IntegerField(null=True)

    class Meta:
        db_table = 'library_screening'

    def __repr__(self):
        return (
            '<LibraryScreening(activity_id=%r, performed_by=%r, '
            'screen=%r, volume=%r)>' 
            % (self.activity_id, self.performed_by, self.screen.facility_id,
                self.volume_transferred_per_well_from_library_plates))

class CherryPickScreening(Screening):
    '''
    Purpose, to record a "Screening" activity for the plates of a Cherry Pick
    # 20180925 - May remove, not used in ICCBL
    # TODO: replace with Cherry Pick Status change
    '''
    
    screeninglink = models.OneToOneField(
        'Screening', primary_key=True, parent_link=True, 
        db_column='activity_id', on_delete=models.CASCADE)
    cherry_pick_request = models.ForeignKey(
        'CherryPickRequest', on_delete=models.CASCADE)

    class Meta:
        db_table = 'cherry_pick_screening'

    def __repr__(self):
        return (
            '<CherryPickScreening(activity_id=%r, performed_by=%r, '
            'screen=%r, cpr=%d )>' 
            % (self.activity_id, self.performed_by, self.screen.facility_id,
                self.cherry_pick_request.id))

class CherryPickLiquidTransfer(LabActivity):
    '''
    Purpose: to record the "Cherry Pick Plate Activity" on the CherryPickAssayPlates
    '''
    
    cherry_pick_request = models.ForeignKey(
        'CherryPickRequest', on_delete=models.CASCADE, null=False)
    labactivitylink = models.OneToOneField(
        'LabActivity', primary_key=True, parent_link=True, 
        db_column='activity_id', on_delete=models.CASCADE)
    
    # Deprecated
    status = models.TextField()
    
    class Meta:
        db_table = 'cherry_pick_liquid_transfer'

    def __repr__(self):
        return (
            '<CPLT(activity_id=%r, performed_by=%r, '
            'screen=%r, volume=%r)>' 
            % (self.activity_id, self.performed_by, self.screen.facility_id,
                self.volume_transferred_per_well_from_library_plates))



class AssayPlate(models.Model):
    '''
    Purpose: map library_screening->plate, with ordinal count

    Old use: to correlate screening data (plates) to data loading plates, but
    data loading plates have been removed.
    
    '''
    
    assay_plate_id = models.AutoField(primary_key=True)
    replicate_ordinal = models.IntegerField(db_index=True)
    screen = models.ForeignKey('Screen', on_delete=models.CASCADE)
    plate = models.ForeignKey('Plate', null=True, on_delete=models.CASCADE)
    plate_number = models.IntegerField(db_index=True)

    library_screening = models.ForeignKey('LibraryScreening', null=True,
        on_delete=models.CASCADE)

    # Deprecated field: per JAS, will not attempt to track plates loaded when
    # loading screen result
    # screen_result_data_loading = \
    # models.ForeignKey('AdministrativeActivity', null=True, 
    # on_delete=models.SET_NULL)

    class Meta:
        db_table = 'assay_plate'
        unique_together=(('library_screening','plate','replicate_ordinal'))

    def __repr__(self):
        return (
            '<AssayPlate(assay_plate_id=%d, ordinal=%d, plate_number=%r, '
            'copy_name=%r, screen=%r, library_screening=%r)>'
            % (self.assay_plate_id, self.replicate_ordinal, self.plate_number, 
               self.plate.copy_name, self.screen.facility_id, 
               self.library_screening.activity_id ))
      
class AssayWell(models.Model):
    '''
    Purpose: AssayWell serves as a "row" of a ScreenResult
    '''
    
    assay_well_id = models.AutoField(primary_key=True)
    assay_well_control_type = models.TextField(null=True,)
    is_positive = models.BooleanField(default=False, db_index=True)
    screen_result = models.ForeignKey(
        'ScreenResult', on_delete=models.CASCADE)
    well = models.ForeignKey('Well', on_delete=models.CASCADE)
    confirmed_positive_value = models.TextField(null=True,)
    
    # New field
    plate_number = models.IntegerField(null=False)
    
    class Meta:
        db_table = 'assay_well'

    def __repr__(self):
        return (
            '<AssayWell(assay_well_id=%d, assay_well_control_type=%r, '
            'well_id=%r, screen=%r)>'
            % (self.assay_well_id, self.assay_well_control_type, 
               self.well.well_id, self.screen.facility_id ))

class AttachedFile(models.Model):
    
    attached_file_id = models.AutoField(primary_key=True) 
    date_created = models.DateTimeField(default=timezone.now)
    contents = models.BinaryField()
    filename = models.TextField()
    type = models.TextField()
    # Fixme: created_by should be non-null
    created_by = models.ForeignKey(
        'ScreensaverUser', null=True, related_name='attachedfilecreated',
        on_delete=models.SET_NULL)
    file_date = models.DateField(null=True)
    date_loaded = models.DateTimeField(null=True)
    date_publicly_available = models.DateTimeField(null=True)
    publication = models.OneToOneField(
        'Publication', null=True, on_delete=models.CASCADE)
    reagent = models.ForeignKey('Reagent', null=True, on_delete=models.CASCADE)
    screen = models.ForeignKey('Screen', null=True, on_delete=models.CASCADE)
    screensaver_user = models.ForeignKey(
        'ScreensaverUser', null=True, on_delete=models.CASCADE)

    class Meta:
        db_table = 'attached_file'
    
    def __repr__(self):
        return (
            '<AttachedFile(attached_file_id=%d, filename=%r, '
            'type=%r, date_created=%r)>' 
            % ( self.attached_file_id, self.filename, self.type, 
                self.date_created) )

class UserChecklist(models.Model):
    
    screensaver_user = models.ForeignKey(
        'ScreensaverUser', null=False, on_delete=models.CASCADE)
    admin_user = models.ForeignKey(
        'ScreensaverUser', null=False, on_delete=models.CASCADE,
        related_name='userchecklistitems_created')
    name = models.TextField()
    is_checked = models.BooleanField()
    date_effective = models.DateField()
    date_notified = models.DateField(null=True)
    
    class Meta:
        db_table = 'user_checklist'
        unique_together=(('screensaver_user','name'))
        
    def __repr__(self):
        return (
            'UserChecklist(screensaver_user=%r, name=%r, '
            'is_checked=%r, date_effective=%r, admin_user=%r )>' 
            % (self.screensaver_user, self.name, self.is_checked, 
                self.date_effective, self.admin_user )) 

class UserAgreement(models.Model):
    
    screensaver_user = models.ForeignKey(
        'ScreensaverUser', null=False, on_delete=models.CASCADE)
    type = models.TextField()
    data_sharing_level = models.IntegerField(null=True)
    file = models.ForeignKey(
        'AttachedFile', null=True, on_delete=models.CASCADE)
    date_active = models.DateField(null=True)
    date_expired = models.DateField(null=True)
    date_notified = models.DateField(null=True)

    class Meta:
        unique_together = (('screensaver_user', 'type'))    
        db_table = 'user_agreement'
    
    def __repr__(self):
        return (
            'UserAgreement(screensaver_user=%r, type=%r, '
            'dsl=%r, date_active=%r, date_expired=%r, date_notified=%r )>' 
            % (self.screensaver_user, self.type, self.data_sharing_level, 
                self.date_active, self.date_expired, self.date_notified )) 

class CherryPickRequest(models.Model):
    
    cherry_pick_request_id = models.AutoField(primary_key=True)
    screen = models.ForeignKey('Screen', on_delete=models.CASCADE)

    transfer_volume_per_well_requested = \
        models.DecimalField(null=True, max_digits=10, decimal_places=9)
    requested_by = models.ForeignKey(
        'ScreensaverUser', on_delete=models.CASCADE,
        related_name='requested_cherry_pick')
    date_requested = models.DateField()

    transfer_volume_per_well_approved = \
        models.DecimalField(null=True, max_digits=10, decimal_places=9)
    volume_approved_by = models.ForeignKey(
        'ScreensaverUser', null=True, related_name='approved_cherry_pick',
        on_delete=models.SET_NULL)
    date_volume_approved = models.DateField(null=True)

    comments = models.TextField(null=True)
    assay_plate_type = models.TextField()
    
    # Cherry Pick Follow-up Assays fields
    assay_protocol_comments = models.TextField(null=True)
    cherry_pick_assay_protocols_followed = models.TextField(null=True)
    cherry_pick_followup_results_status = models.TextField(null=True)

    # True when screener requested a random layout for the cherry pick plates
    is_randomized_assay_plate_layout = models.BooleanField(default=False)
    # True when cherry picks from the same source plate should always be 
    # mapped to the same cherry pick plate
    keep_source_plate_cherry_picks_together = models.BooleanField(default=True)

    # deprecated: calculate dynamically
    number_unfulfilled_lab_cherry_picks = models.IntegerField(null=True)
    
    legacy_cherry_pick_request_number = models.IntegerField(null=True)
    
    date_created = models.DateTimeField(default=timezone.now)

    # New
    wells_to_leave_empty = models.TextField(null=True)
    # New - (last) date when the lab_cherry_picks are reserved and mapped to plates
    date_volume_reserved = models.DateField(null=True)


    # Legacy Field
    date_loaded = models.DateTimeField(null=True)
    # Legacy Field
    date_publicly_available = models.DateTimeField(null=True)
    # Legacy Field
    created_by = models.ForeignKey(
        'ScreensaverUser', null=True, related_name='created_cherry_pick',
        on_delete=models.CASCADE)
    
    # TODO: not used
    max_skipped_wells_per_plate = models.IntegerField(null=True)
    
    class Meta:
        db_table = 'cherry_pick_request'
        
        
    @property
    def assay_plate_size(self):
        if not self.assay_plate_type: 
            return 0
        return lims_utils.plate_size_from_plate_type(self.assay_plate_type)
        
    @property
    def assay_plate_available_wells(self):
        assay_plate_size = self.assay_plate_size
        if assay_plate_size == 0:
            raise ValidationError(
                key='assay_plate_type',
                msg='Is not valid')
        return lims_utils.assay_plate_available_wells(
            self.wells_to_leave_empty, assay_plate_size)
        
    def __repr__(self):
        return (
            '<CherryPickRequest(cherry_pick_request_id=%r, screen=%r)>' 
            % (self.cherry_pick_request_id, self.screen.facility_id)) 

class ScreenerCherryPick(models.Model):
    
    screener_cherry_pick_id = models.AutoField(primary_key=True)
    cherry_pick_request = models.ForeignKey(
        'CherryPickRequest', related_name='screener_cherry_picks',
        on_delete=models.CASCADE)
    screened_well = models.ForeignKey('Well', on_delete=models.CASCADE)
    
    # New
    selected = models.NullBooleanField(null=True)
    searched_well = models.ForeignKey(
        'Well', related_name='searched_screener_cherry_pick', null=False,
        on_delete=models.CASCADE)
    
    class Meta:
        db_table = 'screener_cherry_pick'

    def __repr__(self):
        return (
            '<ScreenerCherryPick(screener_cherry_pick_id=%d, cpr_id=%d, '
            'screened_well=%r)>'
            % (self.screener_cherry_pick_id, 
               self.cherry_pick_request.cherry_pick_request_id,
               self.screened_well.well_id))

class LabCherryPick(models.Model):
    '''
    LabCherryPick is the "deconvoluted" well corresponding to the 
    ScreenerCherryPick:
    - in the case of SiRNA "pool" wells being mapped to "duplex" wells
    - all others will be the same well 
    (Small Molecule libraries, non-pool libraries)
    
    '''
    
    lab_cherry_pick_id = models.AutoField(primary_key=True)
    cherry_pick_request = models.ForeignKey(
        'CherryPickRequest', related_name='lab_cherry_picks',
        on_delete=models.CASCADE)
    screener_cherry_pick = models.ForeignKey(
        'ScreenerCherryPick', on_delete=models.CASCADE)
    source_well = models.ForeignKey('Well', on_delete=models.CASCADE)
    cherry_pick_assay_plate = models.ForeignKey(
        'CherryPickAssayPlate', null=True, on_delete=models.SET_NULL)
    assay_plate_row = models.IntegerField(null=True)
    assay_plate_column = models.IntegerField(null=True)
    
    copy = models.ForeignKey(
        'Copy', null=True, on_delete=models.SET_NULL, 
        related_name='copy_lab_cherry_picks')
    
    is_manually_selected = models.NullBooleanField()
    
    class Meta:
        db_table = 'lab_cherry_pick'

    def __repr__(self):
        return (
            '<LabCherryPick(lab_cherry_pick_id=%r, cpr_id=%r, source_well=%r, '
            'copy=%r, cherry_pick_assay_plate=%r,'
            'assay_plate_row=%r, assay_plate_column=%r)>' 
            % (self.lab_cherry_pick_id, self.cherry_pick_request_id, 
               self.source_well.well_id, self.copy, self.cherry_pick_assay_plate, 
               self.assay_plate_row,
               self.assay_plate_column)) 

class CherryPickAssayPlate(models.Model):
    '''
    Purpose:
    - assign plate_ordinal to LabCherryPick wells
    - record the "plating" activity    
    - OLD: record each attempt for a cherry pick (support for "failed")
    '''
    
    cherry_pick_assay_plate_id = models.AutoField(primary_key=True)
    cherry_pick_request = models.ForeignKey(
        'CherryPickRequest', related_name='cherry_pick_assay_plates',
        on_delete=models.CASCADE)
    plate_ordinal = models.IntegerField()
    assay_plate_type = models.TextField()

    # TODO: 20180925 - remove new fields for plating and screening activities:
    # - for now, these are mirrored by the activity fields:
    # (With activity_refactor, will keep 1 cplt, and 1 screening activity:
    # plating and screening information can be maintained in the activity class
    plating_date = models.DateField(null=True)
    plated_by = models.ForeignKey(
        'ScreensaverUser', null=True, on_delete=models.SET_NULL,
        related_name='plated_cherry_pick_plates')
    screening_date = models.DateField(null=True)
    screened_by = models.ForeignKey(
        'ScreensaverUser', null=True, on_delete=models.SET_NULL,
        related_name='screened_cherry_pick_plates')

    # TODO: 20180913 - migrate 
    cherry_pick_liquid_transfer = models.ForeignKey(
        'CherryPickLiquidTransfer', null=True, on_delete=models.SET_NULL)
    
    # Deprecated fields:
    # status = models.TextField(null=True)
    attempt_ordinal = models.IntegerField()
    legacy_plate_name = models.TextField(null=True)
    
    # TODO: deprecate: created to distinguish between:
    # "LegacyCherryPickAssayPlate" and "CherryPickAssayPlate"
    cherry_pick_assay_plate_type = models.CharField(max_length=31)

    class Meta:
        unique_together = ((
            'cherry_pick_request', 'plate_ordinal','attempt_ordinal'))    
        db_table = 'cherry_pick_assay_plate'

    def __repr__(self):
        return (
            '<CherryPickAssayPlate(cpr_id=%r, '
            'plate_ordinal=%r)>' 
            % (self.cherry_pick_request_id, 
               self.plate_ordinal)) 

class Publication(models.Model):
    
    publication_id = models.AutoField(primary_key=True)
    authors = models.TextField()
    journal = models.TextField()
    pages = models.TextField()
    pubmed_id = models.TextField()
    title = models.TextField()
    volume = models.TextField()
    year_published = models.TextField()
    pubmed_central_id = models.IntegerField(null=True)
    screen = models.ForeignKey('Screen', null=True, on_delete=models.CASCADE)
    reagent = models.ForeignKey('Reagent', null=True, on_delete=models.CASCADE)
    
    class Meta:
        db_table = 'publication'

    def __repr__(self):
        return (
            '<Publication(id=%r, title=%r, screen=%r, reagent=%r)>'
            % (self.publication_id, self.title, self.screen, 
               self.reagent)) 

class Screen(models.Model):

    screen_id = models.AutoField(primary_key=True) 
    facility_id = models.TextField(unique=True)
    
    parent_screen = models.ForeignKey(
        'Screen', null=True, related_name='follow_up_screen',
        on_delete=models.CASCADE)
    
    status = models.TextField(null=True)
    status_date = models.DateField(null=True)
    
    assay_type = models.TextField(null=True)
    screen_type = models.TextField(null=False)
    title = models.TextField(null=False)
    summary = models.TextField()

    lead_screener = models.ForeignKey(
        'ScreensaverUser', null=True, on_delete=models.PROTECT,
        related_name='led_screen')
    lab_head = models.ForeignKey(
        'ScreensaverUser', null=True, on_delete=models.PROTECT,
        related_name='lab_head_screen')
    collaborators = models.ManyToManyField('ScreensaverUser', 
        related_name='collaborating_screens')

    date_of_application = models.DateField(null=True)
    data_meeting_complete = models.DateField(null=True)
    data_meeting_scheduled = models.DateField(null=True)
    perturbagen_molar_concentration = models.DecimalField(
        null=True, max_digits=13, decimal_places=12)
    perturbagen_ug_ml_concentration = models.DecimalField(
        null=True, max_digits=5, decimal_places=3)
    
    publishable_protocol = models.TextField(null=True)
    publishable_protocol_comments = models.TextField(null=True)
    publishable_protocol_entered_by = models.TextField(null=True)
    publishable_protocol_date_entered = models.DateField(null=True)

    data_sharing_level = models.IntegerField(null=False)
    data_privacy_expiration_date = models.DateField(null=True)
    max_allowed_data_privacy_expiration_date = models.DateField(null=True)
    min_allowed_data_privacy_expiration_date = models.DateField(null=True)
    data_privacy_expiration_notified_date = models.DateField(null=True)
    
    comments = models.TextField(null=True)

    coms_registration_number = models.TextField(null=True)
    coms_approval_date = models.DateField(null=True)

    pubchem_deposited_date = models.DateField(null=True)
    pubchem_assay_id = models.IntegerField(null=True)

    # TODO: 20180913, remove with Actvity rework
#     pin_transfer_admin_activity = models.ForeignKey(
#         'Activity', null=True, on_delete=models.CASCADE, 
#         related_name='pin_transfer_approved_screen')
#     # New
#     pin_transfer_approved_by = models.ForeignKey(
#         'ScreensaverUser', null=True,
#         related_name='pin_transfer_approved_screen', on_delete=models.SET_NULL)
#     pin_transfer_date_approved = models.DateField(null=True)
#     pin_transfer_comments = models.TextField(null=True)
    
    abase_study_id = models.TextField(null=True)
    abase_protocol_id = models.TextField(null=True)
    study_type = models.TextField(null=True)
    url = models.TextField(null=True)
    
    to_be_requested = models.BooleanField(default=False) 
    see_comments = models.BooleanField(default=False)
    is_billing_for_supplies_only = models.BooleanField(default=False) 
    is_fee_form_on_file = models.BooleanField(null=False, default=False)
    amount_to_be_charged_for_screen = \
        models.DecimalField(null=True, max_digits=9, decimal_places=2)
    facilities_and_administration_charge = \
        models.DecimalField(null=True, max_digits=9, decimal_places=2)
    fee_form_requested_date = models.DateField(null=True)
    fee_form_requested_initials = models.TextField(null=True)
    billing_info_return_date = models.DateField(null=True)
    date_completed5kcompounds = models.DateField(null=True)
    date_faxed_to_billing_department = models.DateField(null=True)
    date_charged = models.DateField(null=True)
    billing_comments = models.TextField(null=True)
    
    created_by = models.ForeignKey(
        'ScreensaverUser', null=True, on_delete=models.CASCADE)
    
    screened_experimental_well_count = \
        models.IntegerField(null=False, default=0)
    unique_screened_experimental_well_count = \
        models.IntegerField(null=False, default=0)
    
    ####
    # The following stat fields are deprecated: calculated dynamically
    total_plated_lab_cherry_picks = models.IntegerField(null=False, default=0)
    assay_plates_screened_count = models.IntegerField(null=False, default=0)
    library_plates_screened_count = models.IntegerField(null=False, default=0)
    library_plates_data_loaded_count = \
        models.IntegerField(null=False, default=0)
    # Not used: - same as data_loaded
    library_plates_data_analyzed_count = \
        models.IntegerField(null=False, default=0)
    min_screened_replicate_count = models.IntegerField(null=True)
    max_screened_replicate_count = models.IntegerField(null=True)
    min_data_loaded_replicate_count = models.IntegerField(null=True)
    max_data_loaded_replicate_count = models.IntegerField(null=True)
    libraries_screened_count = models.IntegerField(null=True)
    ####
    
    image_url = models.TextField(null=True)
    # FIXME: is well_studied used?
    well_studied = models.ForeignKey('Well', null=True, on_delete=models.CASCADE)
    species = models.TextField(null=True)

    transfection_agent = models.TextField(null=True);
    
    date_created = models.DateTimeField(default=timezone.now)
    date_loaded = models.DateTimeField(null=True)
    date_publicly_available = models.DateTimeField(null=True)
    
    # cell_line = models.ForeignKey('CellLine', null=True) 
    # transfection_agent = models.ForeignKey('TransfectionAgent', null=True)

    # REMOVE for SS2 - study_type replaces this as a marker
    project_phase = models.TextField(null=True)
    # REMOVE for SS2 - use parent_screen instead
    project_id = models.TextField(null=True)
    
    
    
    def get_screen_users(self):
        users = [user for user in self.collaborators.all()]
        users.append(self.lead_screener)
        users.append(self.lab_head)
        return users
    
    def clean(self):
        min = self.min_allowed_data_privacy_expiration_date
        max = self.max_allowed_data_privacy_expiration_date
        if min is not None and max is not None and min > max:
            temp = max
            max = min
            min = temp
            
            self.min_allowed_data_privacy_expiration_date = min
            self.max_allowed_data_privacy_expiration_date = max
        
        dped = self.data_privacy_expiration_date
        
        if dped is not None:
            if min is not None and dped < min:
                self.data_privacy_expiration_date = min
            if max is not None and dped > max:
                self.data_privacy_expiration_date = max
        
    class Meta:
        db_table = 'screen'
        
    def __repr__(self):
        return (
            '<Screen(facility_id=%r, title=%r)>'
            % (self.facility_id, self.title))

class ScreenBillingItem(models.Model):
    screen = models.ForeignKey(Screen, on_delete=models.CASCADE)
    amount = models.DecimalField(max_digits=9, decimal_places=2)
    date_sent_for_billing = models.DateField(null=True)
    item_to_be_charged = models.TextField()
    ordinal = models.IntegerField()
    
    class Meta:
        db_table = 'screen_billing_item'

class ScreenFundingSupports(models.Model):
    screen = models.ForeignKey(
        Screen, on_delete=models.CASCADE, related_name='fundingsupports')
    funding_support = models.TextField()
    
    class Meta:
        unique_together = (('screen', 'funding_support'))
        db_table = 'screen_funding_supports'
        
class ScreenCellLines(models.Model):
    screen = models.ForeignKey(
        Screen, related_name='celllines', on_delete=models.CASCADE)
    cell_line = models.TextField()
    
    class Meta:
        unique_together = (('screen', 'cell_line'))
        db_table = 'screen_cell_lines'
    
class ScreenResult(models.Model):
    
    screen_result_id = models.AutoField(primary_key=True)
    replicate_count = models.IntegerField(default=0)
    screen = models.OneToOneField(
        Screen, unique=True, on_delete=models.CASCADE)
    date_created = models.DateTimeField(default=timezone.now)
    created_by = models.ForeignKey(
        'ScreensaverUser', null=True, on_delete=models.PROTECT)
    channel_count = models.IntegerField(null=True, default=0)
    date_loaded = models.DateTimeField(null=True)
    date_publicly_available = models.DateTimeField(null=True)

    experimental_well_count = models.IntegerField(default=0)

    class Meta:
        db_table = 'screen_result'

    def __repr__(self):
        return (
            "<ScreenResult(screen=%r, date_created=%r)>" 
            % (self.screen.facility_id, self.date_created))


# FIXME: 20180419 - Correct legacy errors with Result Value table:
# - enforce unique(data_column,well) constraint
# - result_value_id_seq is not needed
# - the database is currently  inconsistent, with multiple values for some 
# result value id's (see db.migrations.manual.result_value_cleanup.sql)
# - ResultValues will not be created with the ORM, so this definition
# is for proper database schema creation.
# 
# Indexes to create manually:
#     create index result_value_is_excluded_index 
#         on result_value(data_column_id, is_exclude);
#     create index "result_value_data_column_and_numeric_value_index" 
#         on result_value(data_column_id, numeric_value);
#     create index "result_value_data_column_and_value_index" 
#         on result_value(data_column_id, value);
#     create index "result_value_data_column_and_well_index" 
#         on result_value(data_column_id, well_id);
# NOTE: this constraint will replace the result_value_data_column_and_well_index
#     alter table result_value 
#        ADD constraint data_column_well_id_unique(data_column_id, well_id);

class ResultValue(models.Model):
    
    result_value_id = models.AutoField(primary_key=True)
    assay_well_control_type = models.TextField(null=True)
    is_exclude = models.NullBooleanField(null=True)

    # FIXME: legacy - should be a DecimalField to preserve precision
    numeric_value = models.FloatField(null=True)
    
    is_positive = models.NullBooleanField(null=True)
    value = models.TextField(null=True)
    data_column = models.ForeignKey(
        'DataColumn', null=True, on_delete=models.CASCADE)
    well = models.ForeignKey('Well', null=True, on_delete=models.CASCADE)
    class Meta:
        # FIXME: no primary key defined:
        # - the natural primary key is the (well,datacolumn)
        # unique_together = (('data_column','well'))
        db_table = 'result_value'

class DataColumn(models.Model):

    data_column_id = models.AutoField(primary_key=True)
    screen_result = models.ForeignKey('ScreenResult', on_delete=models.CASCADE)
    ordinal = models.IntegerField()
    replicate_ordinal = models.IntegerField(null=True)
    assay_phenotype = models.TextField()
    assay_readout_type = models.TextField()
    comments = models.TextField()
    description = models.TextField()
    how_derived = models.TextField()
    is_follow_up_data = models.BooleanField(default=False)
    name = models.TextField()
    time_point = models.TextField()
    is_derived = models.BooleanField(default=False)
    positives_count = models.IntegerField(null=True)
    channel = models.IntegerField(null=True)
    time_point_ordinal = models.IntegerField(null=True)
    zdepth_ordinal = models.IntegerField(null=True)
    data_type = models.TextField()
    decimal_places = models.IntegerField(null=True)
    strong_positives_count = models.IntegerField(null=True)
    medium_positives_count = models.IntegerField(null=True)
    weak_positives_count = models.IntegerField(null=True)

    derived_from_columns = models.ManyToManyField(
        'DataColumn', related_name='derived_columns')
    
    class Meta:
        db_table = 'data_column'

    def __repr__(self):
        return (
            "<DataColumn(id=%r, screen=%r, ordinal=%d, name=%r)>" 
            % (self.data_column_id, self.screen_result.screen, self.ordinal, 
               self.name))

@python_2_unicode_compatible
class ScreensaverUser(models.Model):

    screensaver_user_id = models.AutoField(primary_key=True)
    
    date_created = models.DateTimeField(default=timezone.now)
    created_by = models.ForeignKey(
        'self', null=True, on_delete=models.SET_NULL, related_name='created_user')
    date_loaded = models.DateTimeField(null=True)
    date_publicly_available = models.DateTimeField(null=True)
    comments = models.TextField(null=True)

    # FIXME - moved to reports.UserProfile
    phone = models.TextField(null=True)
    mailing_address = models.TextField(null=True)
    harvard_id = models.TextField(null=True)
    harvard_id_expiration_date = models.DateField(null=True)
    harvard_id_requested_expiration_date = models.DateField(null=True)
    
    # TODO: make this unique
    ecommons_id = models.TextField(null=True)

    # Note: mirrored in auth.User
    first_name = models.TextField()
    last_name = models.TextField()
    email = models.TextField(null=True)
    gender = models.TextField(null=True)

    # mirror the userprofile, auth_user username
    # FIXME: 20170926: not needed
    username = models.TextField(null=True, unique=True)

    user = models.OneToOneField(
        'reports.UserProfile', null=True,on_delete=models.SET_NULL)

    # screening_room_user fields
    classification = models.TextField(null=True)
    lab_head = models.ForeignKey(
        'ScreensaverUser', null=True, related_name='lab_members',
        on_delete=models.SET_NULL)
    
    # lab_head fields
    # If this field, if set, designates user as a "Lab Head"
    lab_affiliation = models.ForeignKey(
        'LabAffiliation', null=True, related_name='lab_heads',
        on_delete=models.SET_NULL)
    lab_head_appointment_category = models.TextField(null=True)
    lab_head_appointment_department = models.TextField(null=True)
    lab_head_appointment_update_date = models.DateField(null=True)

    # FIXME: legacy fields
#     sm_data_sharing_level = models.IntegerField(null=True)
#     rnai_data_sharing_level = models.IntegerField(null=True)
#     login_id = models.TextField(unique=True, null=True)
#     digested_password = models.TextField(null=True)
    
    class Meta:
        db_table = 'screensaver_user'
        
    def __repr__(self):
        return (
            '<ScreensaverUser(screensaver_user_id: %r, '
            '%r, %r, ecommons_id: %r, username: %r, user: %r)>' 
            % (self.screensaver_user_id, self.first_name, self.last_name,
                self.ecommons_id, self.username, self.user ))

    def __str__(self):
        return self.__repr__()

class LabAffiliation(models.Model):

    name = models.TextField(unique=True)
    category = models.TextField()
    lab_affiliation_id = models.AutoField(primary_key=True)
    class Meta:
        db_table = 'lab_affiliation'

class Well(models.Model):
    
    well_id = models.TextField(primary_key=True)
    plate_number = models.IntegerField()
    well_name = models.TextField()
    facility_id = models.TextField(null=True)
    library_well_type = models.TextField()
    library = models.ForeignKey('Library', on_delete=models.CASCADE)
    is_deprecated = models.BooleanField(default=False)
    deprecation_reason = models.TextField(null=True)
    
    # latest_released_reagent = models.ForeignKey(
    #     'Reagent', null=True, related_name='reagent_well')
    # Removed - relationship from reagent
    # reagent = models.ForeignKey('Reagent', null=True, related_name='wells')
    
    molar_concentration = \
        models.DecimalField(null=True, max_digits=13, decimal_places=12)
    mg_ml_concentration = \
        models.DecimalField(null=True, max_digits=5, decimal_places=3)
    
    barcode = models.TextField(null=True, unique=True)

    # removed in 0020
    # deprecation_admin_activity = \
    #     models.ForeignKey('AdministrativeActivity', null=True)

    class Meta:
        db_table = 'well'

    def __repr__(self):
        return (
            '<Well(well_id: %r, library: %r)>' 
            % (self.well_id, self.library.short_name ))
        
class CachedQuery(models.Model):
    ''' For caching large resultvalue queries '''
    
    # unique hash of the query sql
    key = models.TextField(unique=True)
    # query sql
    sql = models.TextField()
    # resource uri
    uri = models.TextField(null=False)
    # query params
    params = models.TextField(null=True)
    
    datetime = models.DateTimeField(default=timezone.now)
    username = models.CharField(null=False, max_length=128)
    count = models.IntegerField(null=True)
    
    class Meta:
        db_table = 'cached_query' 

    def __repr__(self):
        return (
            '<CachedQuery(id: %r, uri: %r, username: %r, count:%r)>' 
            % (self.id, self.uri, self.username, self.count ))

class Reagent(models.Model):

    reagent_id = models.AutoField(primary_key=True)
    # substance_id = models.CharField(
    #     max_length=8, unique=True, 
    #     default=create_id)
    
    vendor_identifier = models.TextField(null=True)
    vendor_name = models.TextField(null=True)
    vendor_name_synonym = models.TextField(null=True)
    vendor_batch_id = models.TextField(null=True)
    
    comment = models.TextField(null=True)
    
    # TODO: deprecated
    # library_contents_version = \
    #     models.ForeignKey('LibraryContentsVersion', null=True)

    well = models.ForeignKey(
        'Well', null=True, on_delete=models.CASCADE, related_name='reagents')

    class Meta:
        db_table = 'reagent'

    def __repr__(self):
        return (
            '<Reagent(id: %r, well_id: %r, library: %r)>' 
            % (self.reagent_id, self.well.well_id, 
               self.well.library.short_name ))

class SilencingReagent(Reagent):
    
    reagentlink = models.OneToOneField(
        'Reagent', primary_key=True, parent_link=True, on_delete=models.CASCADE,
        db_column='reagent_id')
    sequence = models.TextField(null=True)
    anti_sense_sequence = models.TextField(null=True)
    silencing_reagent_type = models.TextField(null=True)
    vendor_gene = models.OneToOneField(
        'Gene', unique=True, null=True, on_delete=models.CASCADE, 
        related_name='vendor_reagent')
    facility_gene = models.OneToOneField(
        'Gene', unique=True, null=True, on_delete=models.CASCADE, 
        related_name='facility_reagent')
    duplex_wells = models.ManyToManyField('Well')
    is_restricted_sequence = models.NullBooleanField(default=False)

    class Meta:
        db_table = 'silencing_reagent'

    def __repr__(self):
        return (
            '<SilencingReagent(id: %r, well_id: %r, library: %r)>' 
            % (self.reagent_id, self.well.well_id, 
               self.well.library.short_name ))

class Gene(models.Model):
    
    gene_id = models.AutoField(primary_key=True)
    entrezgene_id = models.IntegerField(null=True)
    gene_name = models.TextField()
    species_name = models.TextField()

    class Meta:
        db_table = 'gene'

    def __repr__(self):
        return (
            '<Gene(id: %r, entrezegene_id: %r, gene_name: %r)>' 
            % (self.gene_id, self.entrezgene_id, self.gene_name ))

class GeneGenbankAccessionNumber(models.Model):
    
    gene = models.ForeignKey(Gene, on_delete=models.CASCADE)
    genbank_accession_number = models.TextField()
    class Meta:
        unique_together = (('gene', 'genbank_accession_number'))    
        db_table = 'gene_genbank_accession_number'

    def __repr__(self):
        return (
            '<GeneGenbankAccessionNumber(gene: %r, genbank_accession_number: %s)>' 
            % (self.gene, self.genbank_accession_number ))

class GeneSymbol(models.Model):
    
    gene = models.ForeignKey(Gene, on_delete=models.CASCADE)
    entrezgene_symbol = models.TextField()
    ordinal = models.IntegerField()
    class Meta:
        unique_together = (('gene', 'ordinal'))    
        db_table = 'gene_symbol'


class SmallMoleculeReagent(Reagent):

    reagentlink = models.OneToOneField(
        'Reagent', primary_key=True, parent_link=True,
        on_delete=models.CASCADE, db_column='reagent_id')
    inchi = models.TextField(null=True)
    molecular_formula = models.TextField(null=True)
    molecular_mass = \
        models.DecimalField(null=True, max_digits=15, decimal_places=9)
    molecular_weight = \
        models.DecimalField(null=True, max_digits=15, decimal_places=9)
    smiles = models.TextField(null=True)
    is_restricted_structure = models.NullBooleanField(default=False)

    class Meta:
        db_table = 'small_molecule_reagent'

    def __repr__(self):
        return (
            '<SmallMoleculeReagent(id: %r, well_id: %r, library: %r)>' 
            % (self.reagent_id, self.well.well_id, 
               self.well.library.short_name ))

class Molfile(models.Model):
    
    molfile = models.TextField()
    reagent = models.OneToOneField(
        'Reagent', unique=True, primary_key=True, on_delete=models.CASCADE)

    class Meta:
        db_table = 'molfile'

class NaturalProductReagent(Reagent):
    
    reagentlink = models.OneToOneField(
        'Reagent', primary_key=True, parent_link=True, 
        on_delete=models.CASCADE, db_column='reagent_id')

    class Meta:
        db_table = 'natural_product_reagent'

class SmallMoleculeChembankId(models.Model):
    
    reagent = models.ForeignKey('Reagent', on_delete=models.CASCADE)
    chembank_id = models.IntegerField()
    
    class Meta:
        db_table = 'small_molecule_chembank_id'

class SmallMoleculeChemblId(models.Model):
    
    reagent = models.ForeignKey('Reagent', on_delete=models.CASCADE)
    chembl_id = models.IntegerField()
    
    class Meta:
        db_table = 'small_molecule_chembl_id'

class SmallMoleculeCompoundName(models.Model):
    
    reagent = models.ForeignKey('Reagent', on_delete=models.CASCADE)
    compound_name = models.TextField()
    ordinal = models.IntegerField()
    
    class Meta:
        db_table = 'small_molecule_compound_name'

class SmallMoleculePubchemCid(models.Model):
    
    reagent = models.ForeignKey('Reagent', on_delete=models.CASCADE)
    pubchem_cid = models.IntegerField()
    
    class Meta:
        db_table = 'small_molecule_pubchem_cid'

class SmallMoleculeCherryPickRequest(models.Model):
    
    cherry_pick_request = \
        models.OneToOneField(
            CherryPickRequest, primary_key=True, on_delete=models.CASCADE)
    
    class Meta:
        db_table = 'small_molecule_cherry_pick_request'

class Library(models.Model):
    
    library_id = models.AutoField(primary_key=True) 
    library_name = models.TextField(unique=True)
    short_name = models.TextField(unique=True)
    description = models.TextField()
    provider = models.TextField()
    screen_type = models.TextField()
    library_type = models.TextField()
    start_plate = models.IntegerField(unique=True)
    end_plate = models.IntegerField(unique=True)
    screening_status = models.TextField()
    date_received = models.DateField(null=True)
    date_screenable = models.DateField(null=True)
    date_created = models.DateTimeField(default=timezone.now)
    plate_size = models.TextField()

    experimental_well_count = models.IntegerField(null=True)
    is_pool = models.NullBooleanField(null=True)
    
    created_by = models.ForeignKey(
        'ScreensaverUser', null=True, on_delete=models.SET_NULL)
    owner_screener = models.ForeignKey(
        'ScreensaverUser', null=True, on_delete=models.SET_NULL,
        related_name='owned_library')
    solvent = models.TextField()
    date_loaded = models.DateTimeField(null=True)
    date_publicly_available = models.DateTimeField(null=True)
    
    version_number = models.IntegerField(default=0)
    loaded_by = models.ForeignKey(
        'ScreensaverUser', on_delete=models.SET_NULL, 
        related_name='libraries_loaded', null=True)
    
    is_released = models.BooleanField(default=False)
    is_archived = models.BooleanField(default=False)
    
    # deprecated: SS1 only
    latest_released_contents_version_id = models.IntegerField(null=True)
    
    @property
    def classification(self):
        if self.screen_type == 'rnai':
            return 'rnai'
        else:
            if self.library_type == 'natural_products':
                return 'natural_product'
            else:
                return 'small_molecule'
    
    class Meta:
        db_table = 'library'

    def __repr__(self):
        return (
            '<Library(id: %r, short_name: %r, '
            'screen_type: %r, library_type: %r)>' 
            % (self.library_id, self.short_name, 
               self.screen_type, self.library_type ))

class Copy(models.Model):

    usage_type = models.TextField()
    library = models.ForeignKey('Library', on_delete=models.CASCADE)
    name = models.TextField()
    copy_id = models.AutoField(primary_key=True)
    comments = models.TextField()
    date_created = models.DateTimeField(default=timezone.now)
    created_by = models.ForeignKey(
        'ScreensaverUser', null=True, on_delete=models.PROTECT)
    date_plated = models.DateField(null=True)
    
    date_loaded = models.DateTimeField(null=True)
    date_publicly_available = models.DateTimeField(null=True)

    class Meta:
        db_table = 'copy'

    def __repr__(self):
        return ('<Copy(library.short_name=%r, name=%r, usage_type=%r, id=%r )>' 
            % (self.library.short_name, self.name, self.usage_type, self.copy_id))

class Plate(models.Model):

    plate_id = models.AutoField(primary_key=True)
    plate_type = models.TextField()
    plate_number = models.IntegerField()
    
    well_volume = models.DecimalField(
        null=True, max_digits=10, decimal_places=9)
    
    copy = models.ForeignKey(Copy, on_delete=models.CASCADE)
    facility_id = models.TextField()
    date_created = models.DateTimeField(default=timezone.now)
    created_by = models.ForeignKey(
        'ScreensaverUser', null=True, on_delete=models.SET_NULL)
    plate_location = models.ForeignKey(
        'PlateLocation', null=True, on_delete=models.SET_NULL)
    status = models.TextField()
    stock_plate_number = models.IntegerField(null=True)
    quadrant = models.IntegerField(null=True)

    # New - to be populated by migration
    remaining_well_volume = models.DecimalField(
        null=True, max_digits=10, decimal_places=9)
    screening_count = models.IntegerField(null=True, default=0)
    # New - Track the screening_count due to cherry_pick_liquid_transfers
    # To be populated by migration
    cplt_screening_count = models.IntegerField(null=True, default=0)
    experimental_well_count = models.IntegerField(null=True)
    
    # New - to be populated by migration
    molar_concentration = \
        models.DecimalField(null=True, max_digits=13, decimal_places=12)
    mg_ml_concentration = \
        models.DecimalField(null=True, max_digits=5, decimal_places=3)
    
    # New - to be populated by migration
    date_plated = models.DateField(null=True)
    date_retired = models.DateField(null=True)
 
    # New - to be bulk updated by screening staff
    is_active = models.NullBooleanField()
    
    # Legacy
    date_loaded = models.DateTimeField(null=True)
    date_publicly_available = models.DateTimeField(null=True)
    
    class Meta:
        db_table = 'plate'
        unique_together = (('plate_number', 'copy'))
        
    def __repr__(self):
        return ('<Plate(copy=%r, plate_number=%d, well_volume=%r)>' 
            % (self.copy.name, self.plate_number, self.well_volume))

class CopyWell(models.Model):

    plate = models.ForeignKey('Plate', on_delete=models.CASCADE)
    copy = models.ForeignKey('Copy', on_delete=models.CASCADE)
    well = models.ForeignKey('Well', on_delete=models.CASCADE)
    volume = models.DecimalField(null=True, max_digits=10, decimal_places=9)
    initial_volume = \
        models.DecimalField(null=True, max_digits=10, decimal_places=9)
    
    # Removed: screening count is tracked only on the plate level, and 
    # adjustment count is simple count of apilogs for volume changes
    # adjustments = models.IntegerField()
    cherry_pick_screening_count = models.IntegerField(null=True)
    
    # New - to be populated by migration
    molar_concentration = \
        models.DecimalField(null=True, max_digits=13, decimal_places=12)
    mg_ml_concentration = \
        models.DecimalField(null=True, max_digits=5, decimal_places=3)
    
    class Meta:
        db_table = 'copy_well'
        unique_together = (('copy', 'plate', 'well'))

    def __repr__(self):
        return ('<CopyWell(well=%r, copy=%r, volume: %r)>' 
            % (self.well.well_id, self.copy.name, self.volume))

class PlateLocation(models.Model):
    
    plate_location_id = models.AutoField(primary_key=True)
    bin = models.TextField()
    freezer = models.TextField()
    room = models.TextField()
    shelf = models.TextField()
    
    class Meta:
        db_table = 'plate_location'
    
    def __repr__(self):
        return (
            '<PlateLocation(room=%r, freezer=%r, shelf=%r, bin=%r, '
            'plate_location_id=%r)>' 
            % (self.room, self.freezer, self.shelf, self.bin, 
               self.plate_location_id) )

class AbaseTestset(models.Model):
    
    abase_testset_id = models.IntegerField(primary_key=True)
    screen = models.ForeignKey('Screen', on_delete=models.CASCADE)
    testset_name = models.TextField()
    comments = models.TextField()
    testset_date = models.DateField()
    class Meta:
        db_table = 'abase_testset'

class RawDataTransform(models.Model):
    ''' Store meta data for a raw data input transformation ''' 
    
    screen = models.OneToOneField(
        'Screen', null=True, on_delete=models.CASCADE)
    cherry_pick_request = models.OneToOneField(
        'CherryPickRequest', null=True, on_delete=models.CASCADE)
    
    plate_ranges = models.TextField(null=True)
    output_filename = models.TextField(null=True)
    output_sheet_option = models.TextField(null=True)
    assay_plate_size = models.TextField(null=True)
    assay_positive_controls = models.TextField(null=True)
    assay_negative_controls = models.TextField(null=True)
    assay_other_controls = models.TextField(null=True)
    library_controls = models.TextField(null=True)
    library_plate_size = models.TextField(null=True)
    comments = models.TextField(null=True)
    
    temp_output_filename = models.TextField(null=True)

    class Meta:
        db_table = 'raw_data_transform'
    
class RawDataInputFile(models.Model):
    ''' Store meta data for a raw data input file transformation ''' 
    
    raw_data_transform = models.ForeignKey(
        'RawDataTransform', on_delete=models.CASCADE)
    ordinal = models.IntegerField()
    
    collation_order = models.TextField(null=True)
    conditions = models.TextField(null=True)
    readouts = models.TextField(null=True)
    readout_type = models.TextField(null=True)
    replicates = models.IntegerField(null=True)
    filename = models.TextField(null=True)

    class Meta:
        db_table = 'raw_data_input_file'
    

# TODO: remove per discussion with Jen
# Deprecated
class ScreenKeyword(models.Model):
    
    screen = models.ForeignKey(
        'Screen', related_name='keywords', on_delete=models.CASCADE)
    keyword = models.TextField()
    
    class Meta:
        unique_together = (('screen', 'keyword'))
        db_table = 'screen_keyword'

# NOTE: created dynamically in db/api.py
# class WellQueryIndex(models.Model):
#     ''' For caching large resultvalue queries '''
#      
#     well = models.ForeignKey(
#         'Well', null=False, on_delete=models.CASCADE)
#     query = models.ForeignKey(
#         'CachedQuery', null=False, on_delete=models.CASCADE)
# 
#     class Meta:
#         db_table = 'well_query_index'
# 
#     def __repr__(self):
#         return (
#             '<WellQueryIndex(id: %r, well: %r, query: %r)>' 
#             % (self.id, self.well, self.query ))
        
# NOTE: 2018-07-09: proposed, but unused 
# def create_id():
#     try:
#         cursor = connection.cursor()
#         cursor.execute("SELECT nextval('substance_id_seq')")
#         row = cursor.fetchone();
#         val = row[0]
#         new_id = create_substance_id(val)
#         if val % 10000 == 0:
#             logger.debug('created substance id %r from %r', new_id,val)
#         logger.debug('seq: %r, created_id: %r', val, new_id)
#         return new_id
#     except Exception, e:
#         return None
# 
# class Substance(models.Model):
#     ''' Substance is the ORM specific method for creating the substance_id_seq
#     '''
#     comment = models.TextField(null=True)
#     
#     def __unicode__(self):
#         return unicode(str(self.id)) 
#     
#     class Meta:
#         db_table = 'substance'

###################################
# Archive: Old Screensaver 1 tables
###################################

# 20180919: Activity Refactor:
# 1. combine ServiceActivity into Activity:
#  - move SA.serviced_user, SA.serviced_screen
#  - move SA.service_activity_type to Activity.type
#  - populate Activity.classification with SA types: LS, extLS, and CPLT; 
#    as well as new "training" and "automation" service activity types
# 2. move LabActivity.screen -> Activity.screen
# 3. Remove unused activity tables and join tables 

# # Purpose: to cast CherryPickRequest for SiRNA screens
# # Deprecate
# class RnaiCherryPickRequest(models.Model):
#     
#     cherry_pick_request = \
#         models.OneToOneField(
#             CherryPickRequest, primary_key=True, on_delete=models.CASCADE)
#     
#     class Meta:
#         db_table = 'rnai_cherry_pick_request'

        
# TODO: remove, see migrations 0004, 0007
# class ScreeningRoomUser(models.Model):
#     
#     screensaver_user = models.OneToOneField(
#         'ScreensaverUser', primary_key=True, on_delete=models.CASCADE)
#     # TODO: remove after all migrations
#     user_classification = models.TextField()
#     lab_head = models.ForeignKey('LabHead', null=True, on_delete=models.CASCADE)
#     
#     coms_crhba_permit_number = models.TextField()
#     coms_crhba_permit_principal_investigator = models.TextField()
#     
#     # # TODO: remove after all migrations
#     # last_notified_smua_checklist_item_event = models.ForeignKey(
#     #     ChecklistItemEvent, null=True, related_name='smua_user')
#     # # TODO: remove after all migrations
#     # last_notified_rnaiua_checklist_item_event = models.ForeignKey(
#     #     ChecklistItemEvent, null=True, related_name='rnai_ua_user')
# 
#     class Meta:
#         db_table = 'screening_room_user'
# 
#     def __repr__(self):
#         return (
#             '<ScreeningRoomUser(screensaver_user_id: %r, username: %r)>' 
#             % (self.screensaver_user.screensaver_user_id, 
#                self.screensaver_user.username ))

# Removed, see migration 0007, 0098
# class AdministratorUser(models.Model):
#     
#     screensaver_user = models.OneToOneField(
#         'ScreensaverUser', primary_key=True, on_delete=models.CASCADE)
#     class Meta:
#         db_table = 'administrator_user'
    

# Removed, see migration 0011, 0098
# TODO: remove after all migrations completed; screensaver_user.lab_head_id replaces       
# class LabHead(models.Model):
#     
#     screensaver_user = models.OneToOneField(
#         'ScreensaverUser', primary_key=True, on_delete=models.CASCADE)
#     lab_affiliation = models.ForeignKey(
#         'LabAffiliation', null=True, on_delete=models.CASCADE)
#     lab_head_appointment_category = models.TextField(null=True)
#     lab_head_appointment_department = models.TextField(null=True)
#     lab_head_appointment_update_date = models.DateField(null=True)
#     
#     class Meta:
#         db_table = 'lab_head'
# 
#     def __repr__(self):
#         return (
#             '<LabHead(lab_head_username: %r, '
#             'affiliation: %r)>' 
#             % (self.screensaver_user.username, self.lab_affiliation.name ))

# TODO: 20180919: not needed anymore (per JAS)
# New
# class UserFacilityUsageRole(models.Model):
#     
#     screensaver_user = models.ForeignKey(
#         'ScreensaverUser', on_delete=models.CASCADE)
#     facility_usage_role = models.TextField()
#     class Meta:
#         db_table = 'user_facility_usage_role'
#         unique_together = (('screensaver_user', 'facility_usage_role'))


# TODO: obsoleted by UserFacilityUsageRole: remove after migrating
# class ScreeningRoomUserFacilityUsageRole(models.Model):
#     
#     screening_room_user = models.ForeignKey(
#         ScreeningRoomUser, on_delete=models.CASCADE)
#     facility_usage_role = models.TextField()
#     class Meta:
#         db_table = 'screening_room_user_facility_usage_role'
        
# TODO: remove, see migration 0007 / 0008
# class ScreensaverUserRole(models.Model):
#     
#     screensaver_user = models.ForeignKey(
#         ScreensaverUser, on_delete=models.CASCADE)
#     screensaver_user_role = models.TextField()
#     
#     class Meta:
#         db_table = 'screensaver_user_role'

# # TODO: deprecate
# # django migrations supercede this
# class SchemaHistory(models.Model):
# 
#     screensaver_revision = models.IntegerField(primary_key=True)
#     date_updated = models.DateTimeField(null=True)
#     comment = models.TextField()
#     
#     class Meta:
#         db_table = 'schema_history'
# 
#     def __repr__(self):
#         return (
#             '<SchemaHistory(screensaver_revision=%r, date_updated=%r, '
#             'comment=%r)>'
#             % (self.screensaver_revision, self.date_updated, 
#                self.comment)) 

# # Deprecated: will migrate with the activity migration.
# # Purpose: Link CherryPickScreening Activity(s) to Assay Plate
# # - record the CherryPickScreening activity
# # TODO: deprecate: use a status on the CherryPick instead
# class CherryPickAssayPlateScreeningLink(models.Model):
#     
#     cherry_pick_assay_plate = models.ForeignKey(
#         CherryPickAssayPlate, on_delete=models.CASCADE)
#     cherry_pick_screening = models.ForeignKey(
#         'CherryPickScreening', on_delete=models.CASCADE)
#     class Meta:
#         db_table = 'cherry_pick_assay_plate_screening_link'
    
# 20180925 - refactor; join to Activity
# class ServiceActivity(Activity):
#      
#     activitylink = models.OneToOneField(
#         Activity, primary_key=True, parent_link=True, on_delete=models.CASCADE, 
#         db_column='activity_id')
#     service_activity_type = models.TextField()
# 
#     # 20180922 - to be removed with activity refactor
#     # # NOTE: SS Version 2: require either serviced screen or serviced user
#     # serviced_screen = models.ForeignKey(
#     #     'Screen', null=True, on_delete=models.CASCADE)
#     # serviced_user = models.ForeignKey(
#     #     'ScreensaverUser', null=True, on_delete=models.CASCADE,
#     #     related_name='users_servicing')
#     #   
#     # funding_support = models.TextField(null=True)
#      
#     class Meta:
#         db_table = 'service_activity'
#  
#     def __repr__(self):
#         return (
#             '<ServiceActivity(activity_id=%r, performed_by=%r, '
#             'service_activity_type=%r, serviced_screen=%r, serviced_user=%r)>' 
#             % (self.activity_id, self.performed_by, self.service_activity_type,
#                self.serviced_screen, self.serviced_user))

# Dropped 20180919
# # Purpose: 
# # - to record updates to the CPR; 
# # - to record manual edit of the source copies chosen
# # Deprecate - migration
# class CherryPickRequestUpdateActivity(models.Model):
#     
#     cherry_pick_request = models.ForeignKey(
#         'CherryPickRequest', on_delete=models.CASCADE)
#     update_activity = models.OneToOneField(
#         'AdministrativeActivity', unique=True, on_delete=models.CASCADE)
#     class Meta:
#         db_table = 'cherry_pick_request_update_activity'


# # Purpose:
# # Record LabCherryPick volume deallocations
# # Record manual well volume adjustments
# # Deprecated - migrate to CopyWell & ApiLog records
# class WellVolumeAdjustment(models.Model):
#     
#     well_volume_adjustment_id = models.AutoField(primary_key=True)
#     well = models.ForeignKey('Well', on_delete=models.CASCADE)
#     lab_cherry_pick = models.ForeignKey(
#         'LabCherryPick', null=True, on_delete=models.CASCADE)
#     well_volume_correction_activity = models.ForeignKey(
#         'WellVolumeCorrectionActivity', on_delete=models.CASCADE, null=True)
#     volume = models.DecimalField(null=True, max_digits=10, decimal_places=9)
#     copy = models.ForeignKey('Copy', on_delete=models.CASCADE)
# 
#     class Meta:
#         db_table = 'well_volume_adjustment'
# 
#     def __repr__(self):
#         return (
#             '<WVA(id=%d, well=%r, lab_cherry_pick=%d '
#             'well_volume_correction_activity=%d, volume=%r )>' 
#             % (self.well_volume_adjustment_id, 
#                self.lab_cherry_pick.lab_cherry_pick_id, 
#                self.well_volume_correction_activity.activity_id,
#                self.volume))

# # Deprecated - removed in 0022
# class AdministrativeActivity(models.Model):
#     
#     activity = models.OneToOneField(
#         Activity, primary_key=True, on_delete=models.CASCADE)
#     administrative_activity_type = models.TextField()
#     class Meta:
#         db_table = 'administrative_activity'

# # Deprecate - remove after plate well volume migration
# class WellVolumeCorrectionActivity(models.Model):
#     
#     activity = models.OneToOneField(
#         'AdministrativeActivity', primary_key=True, on_delete=models.CASCADE)
#     class Meta:
#         db_table = 'well_volume_correction_activity'

# # Deprecate - migration
# class LibraryUpdateActivity(models.Model):
#     
#     library = models.ForeignKey('Library', on_delete=models.CASCADE)
#     update_activity = models.ForeignKey(
#         AdministrativeActivity, on_delete=models.CASCADE)
#     class Meta:
#         db_table = 'library_update_activity'

# # Deprecate - migration
# class PlateUpdateActivity(models.Model):
#     
#     plate_id = models.IntegerField()
#     update_activity_id = models.IntegerField(unique=True)
#     class Meta:
#         db_table = 'plate_update_activity'

# Deprecate - migration
# class ScreenResultUpdateActivity(models.Model):
#     
#     screen_result = models.ForeignKey('ScreenResult', on_delete=models.CASCADE)
#     update_activity = models.ForeignKey(AdministrativeActivity,
#         on_delete=models.CASCADE)
#     class Meta:
#         db_table = 'screen_result_update_activity'

# Deprecate - migration
# class ScreenUpdateActivity(models.Model):
#     
#     screen = models.ForeignKey('Screen', on_delete=models.CASCADE)
#     update_activity = models.ForeignKey(
#         AdministrativeActivity, on_delete=models.CASCADE)
#     class Meta:
#         db_table = 'screen_update_activity'

# Deprecate - migration
# class ScreensaverUserUpdateActivity(models.Model):
#     
#     screensaver_user = models.ForeignKey(
#         'ScreensaverUser', on_delete=models.CASCADE)
#     update_activity = models.ForeignKey(
#         AdministrativeActivity, on_delete=models.CASCADE)
#     class Meta:
#         db_table = 'screensaver_user_update_activity'

# Deprecate - migration
# class ActivityUpdateActivity(models.Model):
#     
#     activity = models.ForeignKey(Activity, on_delete=models.CASCADE)
#     update_activity = models.ForeignKey(
#         'AdministrativeActivity', on_delete=models.CASCADE)
#     class Meta:
#         db_table = 'activity_update_activity'

# Deprecate - migration
# class AttachedFileUpdateActivity(models.Model):
#     
#     attached_file = models.ForeignKey('AttachedFile', on_delete=models.CASCADE)
#     update_activity = models.ForeignKey(
#         AdministrativeActivity, on_delete=models.CASCADE)
#     class Meta:
#         db_table = 'attached_file_update_activity'

# Deprecate - migration
# class ChecklistItemEventUpdateActivity(models.Model):
#     
#     checklist_item_event = models.ForeignKey(
#         'ChecklistItemEvent', on_delete=models.CASCADE)
#     update_activity = models.ForeignKey(
#         AdministrativeActivity, on_delete=models.CASCADE)
#     class Meta:
#         db_table = 'checklist_item_event_update_activity'

# # Deprecate - migration
# class CopyUpdateActivity(models.Model):
#     
#     copy_id = models.IntegerField()
#     update_activity_id = models.IntegerField(unique=True)
#     class Meta:
#         db_table = 'copy_update_activity'

# # DEPRECATED, replaced by cpr.wells_to_leave_empty
# class CherryPickRequestEmptyWell(models.Model):
#     
#     cherry_pick_request = models.ForeignKey(
#         CherryPickRequest, on_delete=models.CASCADE)
#     well_name = models.CharField(max_length=255)
#     class Meta:
#         db_table = 'cherry_pick_request_empty_well'


# TODO: deprecated - migrated to UserChecklist, see migration 0007
# class ChecklistItem(models.Model):
#     
#     checklist_item_id = models.IntegerField(primary_key=True)
#     checklist_item_group = models.TextField()
#     is_expirable = models.BooleanField()
#     item_name = models.TextField(unique=True)
#     order_statistic = models.IntegerField()
# 
#     class Meta:
#         db_table = 'checklist_item'
# 
#     def __repr__(self):
#         return (
#             '<ChecklistItem(checklist_item_id=%d, checklist_item_group=%r, '
#             'item_name=%r)>' 
#             % ( self.checklist_item_id, self.checklist_item_group, 
#                 self.item_name))
# 
# # TODO: deprecated - migrated to UserChecklist, see migration 0007
# class ChecklistItemEvent(models.Model):
#     
#     checklist_item_event_id = models.IntegerField(primary_key=True)
#     date_performed = models.DateField(null=True)
#     is_expiration = models.BooleanField()
#     checklist_item_id = models.IntegerField()
#     screening_room_user = models.ForeignKey(
#         'ScreeningRoomUser', on_delete=models.CASCADE)
#     is_not_applicable = models.BooleanField()
#     date_created = models.DateTimeField(default=timezone.now)
#     created_by = models.ForeignKey(
#         'ScreensaverUser', null=True, on_delete=models.CASCADE)
#     date_loaded = models.DateTimeField(null=True)
#     date_publicly_available = models.DateTimeField(null=True)
# 
#     class Meta:
#         db_table = 'checklist_item_event'

# TODO: deprecate
# Not used in SS1
# class LegacySmallMoleculeCasNumber(models.Model):
#     
#     smiles = models.CharField(max_length=2047)
#     cas_number = models.TextField()
#     class Meta:
#         db_table = '_legacy_small_molecule_cas_number'

# # Deprecate - not used
# # Not used in SS1
# class EquipmentUsed(models.Model):
#      
#     equipment_used_id = models.AutoField(primary_key=True)
#     protocol = models.TextField()
#     description = models.TextField()
#     equipment = models.TextField()
#     lab_activity = models.ForeignKey(
#         'LabActivity', on_delete=models.CASCADE)
#  
#     class Meta:
#         db_table = 'equipment_used'
#  
#     def __repr__(self):
#         return (
#             '<EquipmentUsed(id=%d, equipment=%r, lab_activity=%r)>'
#             % (self.equipment_used_id, self.equipment, 
#                self.lab_activity.activity_id ))

# # Deprecated: to be calculated on the fly:
# # Note: this model is not in SS1
# class CopyScreeningStatistics(models.Model):
#     # Added 20160127 - todo test
#     copy = models.OneToOneField('Copy', primary_key=True) 
#     name = models.TextField()
#     short_name = models.TextField()
#     screening_count = models.IntegerField(null=True)
#     ap_count = models.IntegerField(null=True)
#     dl_count = models.IntegerField(null=True)
#     first_date_data_loaded = models.DateField(null=True)
#     last_date_data_loaded = models.DateField(null=True)
#     first_date_screened = models.DateField(null=True)
#     last_date_screened = models.DateField(null=True)
#     class Meta:
#         db_table = 'copy_screening_statistics'
# 
# # Deprecated: to be calculated on the fly
# # Note: this model is not in SS1
# class PlateScreeningStatistics(models.Model):
#     # Added 20160127 - todo test
#     plate = models.OneToOneField('Plate', primary_key=True)
#     plate_number = models.IntegerField(null=True)
#     copy = models.ForeignKey('Copy')
#     copy_name = models.TextField()
#     library_short_name= models.TextField()
#     library = models.ForeignKey('Library')
#     screening_count = models.IntegerField(null=True)
#     ap_count = models.IntegerField(null=True)
#     dl_count = models.IntegerField(null=True)
#     first_date_data_loaded = models.DateField(null=True)
#     last_date_data_loaded = models.DateField(null=True)
#     first_date_screened = models.DateField(null=True)
#     last_date_screened = models.DateField(null=True)
#     class Meta:
#         db_table = 'plate_screening_statistics'

# TODO: remove
# - resolve test/migration dependency (will not build w/out this class)
# class LibraryContentsVersion(models.Model):
#     library_contents_version_id = models.IntegerField(primary_key=True)
#     # version = models.IntegerField()
#     version_number = models.IntegerField()
#     library = models.ForeignKey(Library)
#     library_contents_loading_activity = models.ForeignKey(
#         AdministrativeActivity, related_name='lcv_load')
#     library_contents_release_activity = \
#         models.ForeignKey(
#             AdministrativeActivity, null=True, related_name='lcv_release')
#     class Meta:
#         db_table = 'library_contents_version'

# TODO: remove - replaced by vocabulary
# class TransfectionAgent(models.Model):
#     transfection_agent_id = models.IntegerField(primary_key=True)
#     value = models.TextField(unique=True)
#     # version = models.IntegerField()
#     class Meta:
#         db_table = 'transfection_agent'

# REMOVED - see manual migration 0002
# class ReagentFacilityGenes(models.Model):
#     reagent = models.ForeignKey(SilencingReagent, primary_key=True)
#     gene = models.ForeignKey(Gene, unique=True)
#     ordinal = models.IntegerField()
#     class Meta:
#         managed = False
#         db_table = 'reagent_facility_genes'
#  
# class ReagentVendorGenes(models.Model):
#     reagent = models.ForeignKey(SilencingReagent, primary_key=True)
#     gene = models.ForeignKey(Gene, unique=True)
#     ordinal = models.IntegerField()
#     class Meta:
#         managed = False
#         db_table = 'reagent_vendor_genes'

# class GeneOldEntrezgeneId(models.Model):
#     old_entrezgene_id = models.IntegerField()
#     gene_id = models.IntegerField()
#     class Meta:
#         db_table = 'gene_old_entrezgene_id'
# 
# class GeneOldEntrezgeneSymbol(models.Model):
#     old_entrezgene_symbol = models.TextField()
#     gene_id = models.IntegerField()
#     class Meta:
#         db_table = 'gene_old_entrezgene_symbol'

# Django creates this when it creates the many-to-many relationship 
# class SilencingReagentDuplexWells(models.Model):
#     silencing_reagent = models.ForeignKey(SilencingReagent)
#     well = models.ForeignKey('Well')
#     class Meta:
#         unique_together = (('silencing_reagent', 'well'))    
#         db_table = 'silencing_reagent_duplex_wells'
# class StudyReagentLink(models.Model):
#     study = models.ForeignKey(Screen)
#     reagent = models.ForeignKey(Reagent)
#     class Meta:
#         db_table = 'study_reagent_link'

#class SilencingReagentNonTargettedGenbankAccessionNumber(models.Model):
#    silencing_reagent_id = models.TextField()
#    non_targetted_genbank_accession_number = models.TextField()
#    class Meta:
#        db_table = 'silencing_reagent_non_targetted_genbank_accession_number'

# REMOVED in manual migration 0002: using BinaryField instead
# class ReagentPublicationLink(models.Model):
#     reagent = models.ForeignKey(Reagent)
#     publication_id = models.IntegerField(unique=True)
#     class Meta:
#         db_table = 'reagent_publication_link'

# removed - manual/0003_screen_status.sql are run.
# class ScreenStatusItem(models.Model):
#     screen = models.ForeignKey(Screen)
#     status = models.TextField()
#     status_date = models.DateField()
#     class Meta:
#         db_table = 'screen_status_item'
#         index_together = (('screen', 'status','status_date'),)    

# TODO: Obsoleted by ScreenCellLines: remove after all migrations are done
# class CellLine(models.Model):
#     cell_line_id = models.IntegerField(primary_key=True)
#     value = models.TextField(unique=True)
#     # version = models.IntegerField()
#     class Meta:
#         db_table = 'cell_line'

# Removed in manual migrations
# class ScreenPublicationLink(models.Model):
#     screen = models.ForeignKey(Screen)
#     publication_id = models.IntegerField(unique=True)
#     class Meta:
#         db_table = 'screen_publication_link'



# TODO: Obsoleted by ScreenFundingSupports: remove after migrations are all done
# class ScreenFundingSupportLink(models.Model):
#     screen = models.ForeignKey(Screen)
#     funding_support = models.ForeignKey(FundingSupport)
#     class Meta:
#         db_table = 'screen_funding_support_link'

# class CollaboratorLink(models.Model):
#     collaborator = models.ForeignKey('ScreeningRoomUser')
#     screen = models.ForeignKey('Screen')
#     class Meta:
#         db_table = 'collaborator_link'

# Migrated in 0003
# class AttachedFileType(models.Model):
#     for_entity_type = models.CharField(max_length=31)
#     attached_file_type_id = models.IntegerField(primary_key=True)
#     value = models.TextField()
#     class Meta:
#         db_table = 'attached_file_type'

# class AnnotationType(models.Model):
#     annotation_type_id = models.AutoField(primary_key=True)
#     # version = models.IntegerField()
#     study = models.ForeignKey('Screen')
#     name = models.TextField()
#     description = models.TextField()
#     ordinal = models.IntegerField()
#     is_numeric = models.BooleanField()
#     class Meta:
#         db_table = 'annotation_type'
# 
# class AnnotationValue(models.Model):
#     annotation_value_id = models.IntegerField(null=True)
#     numeric_value = models.FloatField(null=True)
#     value = models.TextField()
#     annotation_type = models.ForeignKey(AnnotationType, null=True)
#     reagent = models.ForeignKey('Reagent', null=True)
#     class Meta:
#         db_table = 'annotation_value'

# DEPRECATED - TODO: REMOVE - replaced by vocabulary
# class FundingSupport(models.Model):
#     funding_support_id = models.IntegerField(primary_key=True)
#     value = models.TextField(unique=True)
#     class Meta:
#         db_table = 'funding_support'



# this is a LINCS table
# class Cell(models.Model):
#     cell_id = models.IntegerField(primary_key=True)
#     alternate_id = models.CharField(max_length=255)
#     alternate_name = models.CharField(max_length=255)
#     batch_id = models.CharField(max_length=255)
#     cell_type = models.CharField(max_length=255)
#     cell_type_detail = models.TextField()
#     center_name = models.CharField(max_length=255)
#     center_specific_id = models.CharField(max_length=255)
#     clo_id = models.CharField(max_length=255)
#     disease = models.CharField(max_length=255)
#     disease_detail = models.TextField()
#     facility_id = models.CharField(max_length=255, unique=True)
#     genetic_modification = models.CharField(max_length=255)
#     mutations_explicit = models.TextField()
#     mutations_reference = models.TextField()
#     name = models.CharField(max_length=255)
#     organ = models.CharField(max_length=255)
#     organism = models.CharField(max_length=255)
#     organism_gender = models.CharField(max_length=255)
#     recommended_culture_conditions = models.TextField()
#     tissue = models.CharField(max_length=255)
#     vendor = models.CharField(max_length=255)
#     vendor_catalog_id = models.CharField(max_length=255)
#     verification = models.TextField()
#     verification_reference_profile = models.TextField()
#     date_created = models.DateTimeField()
#     date_loaded = models.DateTimeField(null=True)
#     date_publicly_available = models.DateTimeField(null=True)
#     created_by = models.ForeignKey('ScreensaverUser', null=True)
#     class Meta:
#         db_table = 'cell'
#
# class CellGrowthProperties(models.Model):
#     cell = models.ForeignKey(Cell)
#     growth_property = models.TextField()
#     class Meta:
#         db_table = 'cell_growth_properties'
# 
# class CellLineage(models.Model):
#     cell = models.ForeignKey(Cell, primary_key=True)
#     class Meta:
#         db_table = 'cell_lineage'
# 
# class CellMarkers(models.Model):
#     cell = models.ForeignKey('PrimaryCell')
#     cell_markers = models.TextField()
#     class Meta:
#         db_table = 'cell_markers'
# 
# class CellRelatedProjects(models.Model):
#     cell = models.ForeignKey(Cell)
#     related_project = models.TextField()
#     class Meta:
#         db_table = 'cell_related_projects'
# 
# class PrimaryCell(models.Model):
#     age_in_years = models.IntegerField()
#     donor_ethnicity = models.CharField(max_length=255)
#     donor_health_status = models.CharField(max_length=255)
#     passage_number = models.IntegerField()
#     cell = models.ForeignKey(Cell, primary_key=True)
#     class Meta:
#         db_table = 'primary_cell'
# LINCS table
# class ExperimentalCellInformation(models.Model):
#     experimental_cell_information_id = models.IntegerField(primary_key=True)
#     cell = models.ForeignKey(Cell)
#     screen = models.ForeignKey('Screen')
#     class Meta:
#         db_table = 'experimental_cell_information'
# 
# class CellUpdateActivity(models.Model):
#     cell = models.ForeignKey('Cell')
#     update_activity = models.ForeignKey(AdministrativeActivity, unique=True)
#     class Meta:
#         db_table = 'cell_update_activity'

