# -*- coding: utf-8 -*-
from __future__ import unicode_literals

from django.db import migrations, models
import logging

logger = logging.getLogger(__name__)

DB_API_URI = '/db/api/v1'

def temp_migrate_breaker(apps,schema_editor):
    raise Exception('xxx stop migration xxx')
        
class Migration(migrations.Migration):

    dependencies = [
        ('db', '0021_library_is_released'),
    ]

    operations = [
        migrations.RunSQL('''
            ALTER TABLE assay_plate DROP COLUMN screen_result_data_loading_id;
            DROP TABLE cherry_pick_request_update_activity;
            DROP TABLE attached_file_update_activity;
            DROP TABLE screensaver_user_update_activity;
            DROP TABLE activity_update_activity;
            DROP TABLE checklist_item_event_update_activity;
            DROP TABLE screen_result_update_activity;
            DROP TABLE screen_update_activity;
            DROP TABLE library_update_activity;
            DROP TABLE well_volume_adjustment;
            DROP TABLE well_volume_correction_activity;
        '''),
        migrations.RemoveField(
            model_name='reagent',
            name='library_contents_version',
        ),
        migrations.DeleteModel(
            name='LibraryContentsVersion'),
             
        migrations.RunSQL('''
            DROP TABLE plate_update_activity;
        '''),
        migrations.RunSQL('''
            DROP TABLE copy_update_activity;
        '''),
        migrations.RunSQL('''
            DROP TABLE cherry_pick_request_empty_well;
        '''),
        migrations.RunSQL('''
            DROP TABLE equipment_used;
        '''),
 
        migrations.DeleteModel(
            name='AdministrativeActivity',
        ),
#         migrations.RunSQL('''
#             update screen set pin_transfer_admin_activity_id = null;
#         '''),
         
#         migrations.RunPython(temp_migrate_breaker),
        
        migrations.RunSQL('''
            create table archived_activities as select * from activity where 
                not (
                   exists(select null from service_activity where activity_id = activity.activity_id)
                or exists(select null from lab_activity where activity_id = activity.activity_id));        
            delete from activity where 
                not ( 
                   exists(select null from service_activity where activity_id = activity.activity_id)
                or exists(select null from lab_activity where activity_id = activity.activity_id));
         '''),
         
        # Move ServiceActivity fields to Activity
         
        migrations.AddField(
            model_name='activity',
            name='screen',
            field=models.ForeignKey(
                to='db.Screen', related_name='activities', null=True,
                on_delete=models.deletion.CASCADE),
        ),
        migrations.AddField(
            model_name='activity',
            name='serviced_user',
            field=models.ForeignKey(
                to='db.ScreensaverUser', related_name='service_activities', null=True,
                on_delete=models.deletion.SET_NULL),
        ),
        migrations.AddField(
            model_name='activity', name='funding_support',
            field=models.TextField(null=True)),
        migrations.AddField(
            model_name='activity', name='classification',
            field=models.TextField(null=True)),
        migrations.AddField(
            model_name='activity', name='type',
            field=models.TextField(null=True)),
             
        migrations.RunSQL('''
            update activity set classification = 'training' 
                where exists(select null from service_activity 
                    where activity_id = activity.activity_id
                    and service_activity_type ilike 'training%');
            update activity set classification = 'automation' 
                where exists(select null from service_activity 
                    where activity_id = activity.activity_id
                    and service_activity_type ilike 'automation%');
            update activity set classification = 'other' 
                where exists(select null from service_activity 
                    where activity_id = activity.activity_id
                    and service_activity_type not ilike 'automation%'
                    and service_activity_type not ilike 'training%');
                     
            update activity set classification = 'screening' 
                where exists(select null from lab_activity 
                    where activity_id = activity.activity_id);
            update activity 
                set screen_id = sa.serviced_screen_id, 
                    serviced_user_id = sa.serviced_user_id, 
                    type = sa.service_activity_type 
                from service_activity sa where sa.activity_id=activity.activity_id;
            update activity 
                set funding_support = fs.value
                from service_activity sa 
                join funding_support fs using(funding_support_id)
                where sa.activity_id=activity.activity_id;
            update activity 
                set screen_id = la.screen_id 
                from lab_activity la where la.activity_id=activity.activity_id;
            update activity
                set type = 'library_screening'
                where exists (select null from library_screening ls 
                    where ls.activity_id=activity.activity_id 
                    and ls.is_for_external_library_plates is not true);
            update activity
                set type = 'ext_library_screening'
                where exists (select null from library_screening ls 
                    where ls.activity_id=activity.activity_id 
                    and ls.is_for_external_library_plates is true);
            update activity
                set type = 'cp_transfer'
                where exists (select null from cherry_pick_liquid_transfer cplt 
                    where cplt.activity_id=activity.activity_id);
            update activity
                set type = 'cp_screening'
                where exists (select null from cherry_pick_screening cps 
                    where cps.activity_id=activity.activity_id);
        '''),
          
        migrations.AlterField(
            model_name='activity', name='classification',
            field=models.TextField(null=False)),
        migrations.AlterField(
            model_name='activity', name='type',
            field=models.TextField(null=False)),
          
        # Reinstate; for final migration
        migrations.AlterField(
            model_name='LabActivity',
            name='screen',
            field=models.ForeignKey(to='db.Screen', null=True),
        ),
#         migrations.DeleteModel('ServiceActivity')
        
        
        
    ]
