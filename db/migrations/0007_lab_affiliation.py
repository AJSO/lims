# -*- coding: utf-8 -*-
from __future__ import unicode_literals

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('db', '0006_screen'),
    ]

    operations = [

        # TODO: 20170918 ======
        # - to be tested with the orchestra migrations
        migrations.AddField(
            model_name='screensaveruser',
            name='lab_head_appointment_category', 
            field=models.TextField(null=True)),

        migrations.AddField(
            model_name='screensaveruser',
            name='lab_head_appointment_department', 
            field=models.TextField(null=True)),

        migrations.AddField(
            model_name='screensaveruser',
            name='lab_head_appointment_update_date', 
            field=models.DateField(null=True)),

        migrations.RunSQL(
            'UPDATE screensaver_user su '
            ' set lab_head_appointment_category=lh.lab_head_appointment_category '
            ' from  lab_head lh '
            ' where lh.screensaver_user_id=su.screensaver_user_id'),
        migrations.RunSQL(
            'UPDATE screensaver_user su '
            ' set lab_head_appointment_department=lh.lab_head_appointment_department '
            ' from  lab_head lh '
            ' where lh.screensaver_user_id=su.screensaver_user_id'),
        migrations.RunSQL(
            'UPDATE screensaver_user su '
            ' set lab_head_appointment_update_date=lh.lab_head_appointment_update_date '
            ' from  lab_head lh '
            ' where lh.screensaver_user_id=su.screensaver_user_id'),
        # end TODO: 20170918 ======
        
        # NOTE: see 0005 for schema field migrations for lab head
        # - because of transactions, schema migration must be elsewhere        
        migrations.RunSQL(
            'UPDATE screensaver_user su '
            ' set lab_head_id=sru.lab_head_id '
            ' from  screening_room_user sru '
            ' where sru.screensaver_user_id=su.screensaver_user_id'),
        migrations.RunSQL(
            'UPDATE screensaver_user su '
            ' set lab_head_id=lh.screensaver_user_id '
            ' from  lab_head lh '
            ' where lh.screensaver_user_id=su.screensaver_user_id'),
         
        migrations.RunSQL(
            'UPDATE screensaver_user su '
            ' set lab_affiliation_id=lh.lab_affiliation_id '
            ' from  lab_head lh '
            ' where lh.screensaver_user_id=su.screensaver_user_id'),
         
        # TODO: drop the LabHead and ScreeningRoomUser models - 20170705
        migrations.RunSQL(
            'ALTER TABLE lab_head '
            'DROP CONSTRAINT fk_lab_head_to_screening_room_user'),
        migrations.RunSQL(
            'ALTER TABLE screening_room_user '
            'DROP CONSTRAINT fk_screening_room_user_to_lab_head'),
        
        # 20170918; stashing here, to avoid sql pending trigger error in 0003
        migrations.RemoveField(
            model_name='screen',
            name='transfection_agent',
        ),
        migrations.RenameField(
            model_name='screen', 
            old_name='transfection_agent_text', 
            new_name='transfection_agent'
        ),
        migrations.AlterField(
            model_name='screen', name='project_phase', 
            field=models.TextField(null=True),
        ),
        migrations.AlterField(
            model_name='screen',
            name='project_id',
            field=models.TextField(null=True),
        ),
        
    ]
