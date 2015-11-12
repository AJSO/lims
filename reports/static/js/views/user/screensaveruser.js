define([
    'jquery',
    'underscore',
    'backbone',
    'iccbl_backgrid',
    'layoutmanager',
    'models/app_state',
    'views/generic_detail_layout',
    'views/list2',
    'views/user/user2',
    'views/generic_edit',
    'text!templates/generic-tabbed.html',
    'bootstrap-datepicker'
], function($, _, Backbone, Iccbl, layoutmanager, 
            appModel, DetailLayout, 
            ListView, ReportsUserView, EditView, layout) {

  var UserView = ReportsUserView.extend({

    screensaver_tabbed_resources: {
      userchecklistitem: {
        description: "User Checklist Items",
        title: "User Checklist Items",
        invoke: "setUserChecklistItems",
        resource: 'userchecklistitem'
      },
      attachedfile: {
        description: "Attached Files",
        title: "Attached Files",
        invoke: "setAttachedFiles",
        resource: 'attachedfile'
      },
      serviceactivity: {
        description: "Service Activities",
        title: "Service Activities",
        invoke: "setServiceActivities",
        resource: 'serviceactivity'
      }
    },
    
    initialize: function(args) {
      UserView.__super__.initialize.apply(this, arguments);      
      var self = this;
      this.tabbed_resources = _.extend({},
        this.tabbed_resources, this.screensaver_tabbed_resources);
      
      _.each(_.keys(this.tabbed_resources), function(key){
        if(key !== 'detail' && !appModel.hasPermission(
            self.tabbed_resources[key].resource,'read')){
          delete self.tabbed_resources[key];
        }
      });
    },

    setDetail: function(delegateStack){
      var key = 'detail';
      var self = this;
      console.log('setDetail: ', delegateStack);
        
      // Create model validation rules based on classification
      this.model.validate = function(attrs) {
        var errs = {};

        if ( attrs.classification == 'principal_investigator' &&
            _.isEmpty(attrs.lab_head_affiliation) ){
          errs.lab_head_affiliation = 'Required if PI';
        }
        if (!_.isEmpty(errs)) return errs;
      };
      
      // onEditCallBack: wraps the edit display function
      // - lazy fetch of the expensive principal investigators hash
      // - perform post-render enhancement of the display
      var onEditCallBack = function(displayFunction){
        
        this.model.resource.schema.fields['permissions']['choices'] = (
            appModel.get('permissionOptions'));
        
        appModel.getPrincipalInvestigatorOptions(function(options){

          self.model.resource.schema.fields['lab_head_username']['choices'] = options;
          
          var editForm = displayFunction();
          
          // with the edit view available, set up the lab_head_affiliation rules
          // - add listener to update options dynamically
          // - attach the "add lab affiliation" button to the view
          
          
          // - add listener to update view options when classification changes
          //    - note we want to replace this with model-driven events
          self.model.on('sync', function(){
            // TODO: should only need to do this if the classification has changed
            // to "PI"; but the changedAttributes are unreliable for detecting this
            if(self.model.get('classification')=='principal_investigator'){
              appModel.unset('principal_investigators');
            }
          });
    
          var addLabAffiliationButton = $([
            '<a class="btn btn-default btn-sm" ',
              'role="button" id="add_button" href="#">',
              'Add</a>'
            ].join(''));
          
          addLabAffiliationButton.click(function(event){
            event.preventDefault();
            self.addLabAffiliation(editForm);
          });

          // Render the editForm; then add the add lab affiliation button
          var temp = editForm.afterRender;
          editForm.afterRender = function(){
            editForm.$el.find('div[key="lab_head_affiliation"]').append(addLabAffiliationButton);
            temp.call(editForm,arguments);
            
            // Set up lab_head_affiliation availability based on classification
            if(editForm.getValue('classification') != 'principal_investigator'){
                editForm.$el.find('[key="form-group-lab_head_affiliation"]').hide();
            }
            // attach classification change listener
            editForm.listenTo(this, "change:classification", function(e){
              var classification = editForm.getValue('classification');
              console.log('classification:' + classification)
              if(classification == 'principal_investigator'){
                editForm.$el.find('[key="form-group-lab_head_affiliation"]').show();
                editForm.setValue('lab_head_username',self.model.get('username'));
                editForm.$el.find('[key="lab_head_username"]').find('.chosen-select').trigger("chosen:updated");
              } else {
                editForm.setValue('lab_head_affiliation','');
                editForm.setValue('lab_head_username','');
                editForm.$el.find('[key="lab_head_username"]').find('.chosen-select').trigger("chosen:updated");
                editForm.$el.find('[key="form-group-lab_head_affiliation"]').hide();
              }
            });
          }; // after render
        });
      };

      var view = this.tabViews[key];
      if (view) {
        // remove the view to refresh the page form
        this.removeView(this.tabViews[key]);
      }
      view = new DetailLayout({ 
        model: this.model, 
        uriStack: delegateStack,
        onEditCallBack: onEditCallBack 
      });

      this.tabViews[key] = view;
      
      // NOTE: have to re-listen after removing a view
      this.listenTo(view , 'uriStack:change', this.reportUriStack);
      // Note: since detail_layout reports the tab, the consumedStack is empty here
      this.consumedStack = []; 
      this.setView("#tab_container", view ).render();
      return view;
    },

    addLabAffiliation: function(editForm){
      var self = this;
      var form_template = [
         "<div class='form-horizontal container' id='addLabAffiliationForm' >",
         "<form data-fieldsets class='form-horizontal container' >",
         "</form>",
         "</div>"].join('');      
      var choiceHash = {}
      try{
        var vocabulary = Iccbl.appModel.getVocabulary('labaffiliation.category');
          _.each(_.keys(vocabulary),function(choice){
            choiceHash[choice] = vocabulary[choice].title;
          });
        var currentAffiliationNames = Iccbl.appModel.getVocabulary('labaffiliation.category.*');
      }catch(e){
        console.log('on get vocabulary', e);
        self.appModel.error('Error locating vocabulary: ' + 'labaffiliation.category');
      }
      var fieldTemplate = _.template([
        '<div class="form-group" >',
        '    <label class="control-label " for="<%= editorId %>"><%= title %></label>',
        '    <div class="" >',
        '      <div data-editor  style="min-height: 0px; padding-top: 0px; margin-bottom: 0px;" />',
        '      <div data-error class="text-danger" ></div>',
        '      <div><%= help %></div>',
        '    </div>',
        '  </div>',
      ].join(''));
      
      var formSchema = {};
      formSchema['affiliation_category'] = {
        title: 'Affiliation Category',
        key: 'affiliation_category',
        type: 'Select',
        validators: ['required'],
        options: choiceHash,
        template: fieldTemplate
      };
      formSchema['affiliation_name'] = {
        title: 'Affiliation Name',
        key: 'affiliation_name',
        type: 'Text',
        validators: ['required'],
        template: fieldTemplate
      };
      formSchema['comments'] = {
        title: 'Comments',
        key: 'comments',
        validators: ['required'],
        type: 'TextArea',
        template: fieldTemplate
      };

      var FormFields = Backbone.Model.extend({
        schema: formSchema,
        validate: function(attrs){
          console.log('form validate', attrs);
          var errs = {};
          var newVal = attrs['affiliation_name'];
          if (newVal){
            newVal = newVal.toLowerCase().replace(/\W+/g, '_');
            if(_.has(currentAffiliationNames,newVal)){
              errs['affiliation_name'] = '"'+ attrs['affiliation_name'] + '" is already used';
            }
          }
          if (!_.isEmpty(errs)) return errs;
        }
      });
      var formFields = new FormFields();
      var form = new Backbone.Form({
        model: formFields,
        template: _.template(form_template)
      });
      var _form_el = form.render().el;

      var dialog = appModel.showModal({
        okText: 'create',
        view: _form_el,
        title: 'Create a new Lab Affiliation',
        ok: function(e){
          e.preventDefault();
          var errors = form.commit({ validate: true }); // runs schema and model validation
          if(!_.isEmpty(errors) ){
            console.log('form errors, abort submit: ',errors);
            _.each(_.keys(errors), function(key){
              $('[name="'+key +'"').parents('.form-group').addClass('has-error');
            });
            return false;
          }else{
            var values = form.getValue();
            var resource = appModel.getResource('vocabularies');
            var key = values['affiliation_name'].toLowerCase().replace(/\W+/g, '_');
            
            var data = {
              'scope': 'labaffiliation.category.' + values['affiliation_category'],
              'key': key,
              'title': values['affiliation_name'],
              'description': values['affiliation_name'],
              'ordinal': (_.max(currentAffiliationNames, function(affil){ return affil.ordinal }) + 1),
              'comment': values['comment']
            };
            
            $.ajax({
              url: resource.apiUri,    
              data: JSON.stringify(data),
              contentType: 'application/json',
              method: 'POST',
              success: function(data){
                appModel.getVocabularies(function(vocabularies){
                  appModel.set('vocabularies', vocabularies);
                });
                appModel.showModalMessage({
                  title: 'Lab Affiliation Created',
                  okText: 'ok',
                  body: '"' + values['affiliation_name'] + '"',
                  ok: function(e){
                    e.preventDefault();
                    editForm.$el.find('[key="lab_head_affiliation"]')
                      .find('.chosen-select').append($('<option>',{
                        value: data['key']
                      }).text(data['title']));
                    editForm.$el.find('[key="lab_head_affiliation"]')
                      .find('.chosen-select').trigger("chosen:updated");

                    appModel.unset('principal_investigators');
                    appModel.unset('vocabularies');
                    appModel.getVocabularies(function(vocabularies){
                      appModel.set('vocabularies', vocabularies);
                      appModel.getPrincipalInvestigatorOptions(function(vocabulary){
                        var choiceHash = []
                        _.each(_.keys(vocabulary),function(choice){
                          if(vocabulary[choice].is_retired){
                            console.log('skipping retired vocab: ',choice,vocabulary[choice].title );
                          }else{
                            choiceHash.push({ val: choice, label: vocabulary[choice].title });
                          }
                        });
                        
                        editForm.fields['lab_head_username'].setOptions(choiceHash);
                        editForm.$el.find('[key="lab_head_username"]')
                          .find('.chosen-select').trigger("chosen:updated");
                      });
                    });
                  }
                });
              },
              done: function(model, resp){
                // TODO: done replaces success as of jq 1.8
                console.log('done');
              },
              error: appModel.jqXHRError
            });
          
            return true;
          }
        }
      });
    
    },
    
    /**
     * Layoutmanager hook
     */
    afterRender: function(){
      UserView.__super__.afterRender.apply(this, arguments);      
    },
    
    click_tab : function(event){
      UserView.__super__.click_tab.apply(this, arguments);      
    },

    change_to_tab: function(key){
      UserView.__super__.change_to_tab.apply(this, arguments);      
    },
    
    setServiceActivities: function(delegateStack) {
      var self = this;
      var key = 'serviceactivity';
      var resource = appModel.getResource('serviceactivity');

      if(!_.isEmpty(delegateStack) && !_.isEmpty(delegateStack[0]) &&
          !_.contains(appModel.LIST_ARGS, delegateStack[0]) ){
        // Detail view
        var activity_id = delegateStack.shift();
        self.consumedStack.push(activity_id);
        var _key = activity_id
        appModel.getModel(resource.key, _key, function(model){
          view = new DetailLayout({
            model: model, 
            uriStack: _.clone(delegateStack)
          });
          Backbone.Layout.setupView(view);
          //self.tabViews[key] = view;

          // NOTE: have to re-listen after removing a view
          self.listenTo(view , 'uriStack:change', self.reportUriStack);
          self.setView("#tab_container", view ).render();
        });        
        return;
      }else{
        // List view
        (function listView(){
          var view, url;
          var extraControls = [];
          var addServiceActivityButton = $([
            '<a class="btn btn-default btn-sm pull-down" ',
              'role="button" id="add_button" href="#">',
              'Add</a>'
            ].join(''));
          var showDeleteButton = $([
            '<a class="btn btn-default btn-sm pull-down" ',
              'role="button" id="showDeleteButton" href="#">',
              'Delete</a>'
            ].join(''));
          var showHistoryButton = $([
            '<a class="btn btn-default btn-sm pull-down" ',
              'role="button" id="showHistoryButton" href="#">',
              'History</a>'
            ].join(''));
          
          addServiceActivityButton.click(function(e){
            e.preventDefault();
            self.addServiceActivity(delegateStack);
          });
          showHistoryButton.click(function(e){
            e.preventDefault();
            var newUriStack = ['apilog','order','-date_time', 'search'];
            var search = {};
            search['ref_resource_name'] = 'serviceactivity';
            search['changes__icontains'] = '"serviced_username": "' + self.model.get('username') + '"';
            newUriStack.push(appModel.createSearchString(search));
            var route = newUriStack.join('/');
            console.log('history route: ' + route);
            appModel.router.navigate(route, {trigger: true});
            self.remove();
          });
          if(appModel.hasPermission(self.model.resource.key, 'edit')){
            extraControls.unshift(addServiceActivityButton);
          }
          if(appModel.hasPermission(self.model.resource.key, 'edit')){
            extraControls.unshift(showDeleteButton);
          }
          extraControls.unshift(showHistoryButton);
          console.log('extraControls',extraControls);
          url = [self.model.resource.apiUri, 
                     self.model.key,
                     'serviceactivities'].join('/');
          view = new ListView({ options: {
            uriStack: _.clone(delegateStack),
            schemaResult: resource.schema,
            resource: resource,
            url: url,
            extraControls: extraControls
          }});
          showDeleteButton.click(function(e){
            e.preventDefault();
            if (! view.grid.columns.findWhere({name: 'deletor'})){
              view.grid.columns.unshift({ 
                name: 'deletor', label: 'Delete', text:'X', 
                description: 'delete record', 
                cell: Iccbl.DeleteCell, sortable: false });
            }
          });
          Backbone.Layout.setupView(view);
          self.consumedStack = [key]; 
          self.reportUriStack([]);
          self.listenTo(view , 'uriStack:change', self.reportUriStack);
          self.setView("#tab_container", view ).render();
        })();
      }
    },
    
    addServiceActivity: function(delegateStack) {
      var self = this;
      
      var resource = Iccbl.appModel.getResource('serviceactivity');
      var defaults = {};
      appModel.getAdminUserOptions(function(options){
        resource.schema.fields['performed_by_username']['choices'] = options;

        _.each(resource.fields, function(value, key){
            if (key == 'resource_uri') {
              defaults[key] = resource.resource_uri;
            } else if (key == 'id'){
            } else {
              defaults[key] = '';
            }
        });
        
        defaults['serviced_username'] = self.model.get('username');
        defaults['serviced_user'] = self.model.get('name');
        defaults['performed_by_username'] = appModel.getCurrentUser().username;
        
        delegateStack.unshift('+add');
        var NewModel = Backbone.Model.extend({
          resource: resource,
          urlRoot: resource.apiUri, 
          defaults: defaults
//          save: function(){
//            console.log('save',arguments);
//            return NewModel.__super__.save.apply(this,arguments);
//          }
        });
        var view = new DetailLayout({
          model: new NewModel(), 
          uriStack: _.clone(delegateStack)
        });
        Backbone.Layout.setupView(view);
        self.listenTo(view,'remove',function(){
          self.setServiceActivities([]);
          self.removeView(view); // todo - test
        });
        self.listenTo(view , 'uriStack:change', self.reportUriStack);
        self.setView("#tab_container", view ).render();

      });
      
    },
    
    setAttachedFiles: function(delegateStack) {
      var self = this;
      var key = 'attachedfile';
      var resource = appModel.getResource('attachedfile');
      var url = [self.model.resource.apiUri, 
                 self.model.key,
                 'attachedfiles'].join('/');
      var uploadAttachedFileButton = $([
        '<a class="btn btn-default btn-sm pull-down" ',
          'role="button" id="save_button" href="#">',
          'Add</a>'
        ].join(''));
      var showDeleteButton = $([
          '<a class="btn btn-default btn-sm pull-down" ',
            'role="button" id="showDeleteButton" href="#">',
            'Delete</a>'
          ].join(''));
      
      var view = new ListView({ options: {
        uriStack: _.clone(delegateStack),
        schemaResult: resource.schema,
        resource: resource,
        url: url,
        extraControls: [uploadAttachedFileButton, showDeleteButton]
      }});
      uploadAttachedFileButton.click(function(e){
        e.preventDefault();
        self.upload(view.collection)
      });
      showDeleteButton.click(function(e){
        e.preventDefault();
        if (! view.grid.columns.findWhere({name: 'deletor'})){
          view.grid.columns.unshift({ 
            name: 'deletor', label: 'Delete', text:'X', 
            description: 'delete record', 
            cell: Iccbl.DeleteCell, sortable: false });
        }
      });

      Backbone.Layout.setupView(view);
      self.consumedStack = [key]; 
      self.reportUriStack([]);
      self.listenTo(view , 'uriStack:change', self.reportUriStack);
      self.setView("#tab_container", view ).render();
      
    },
        
    upload: function(attachedfileCollection){
      var self = this;
      var form_template = [
         "<div class='form-horizontal container' id='uploadAttachedFileButton_form' >",
         "<form data-fieldsets class='form-horizontal container' >",
         "<div class='form-group' ><input type='file' name='fileInput' /></div>",
         "</form>",
         "</div>"].join('');      
      var choiceHash = {}
      try{
        var vocabulary = Iccbl.appModel.getVocabulary('attachedfiletype.user');
          _.each(_.keys(vocabulary),function(choice){
            choiceHash[choice] = vocabulary[choice].title;
          });
      }catch(e){
        console.log('on get vocabulary', e);
        self.appModel.error('Error locating vocabulary: ' + 'attachedfiletype.user');
      }
      
      var fieldTemplate = _.template([
        '<div class="form-group" >',
        '    <label class="control-label " for="<%= editorId %>"><%= title %></label>',
        '    <div class="" >',
        '      <div data-editor  style="min-height: 0px; padding-top: 0px; margin-bottom: 0px;" />',
        '      <div data-error class="text-danger" ></div>',
        '      <div><%= help %></div>',
        '    </div>',
        '  </div>',
      ].join(''));
      
      var formSchema = {};
      formSchema['type'] = {
        title: 'File Type',
        key: 'type',
        type: 'Select',
        options: choiceHash,
        template: fieldTemplate
      };
      formSchema['file_date'] = {
        title: 'File Date',
        key: 'file_date',
        type: EditView.DatePicker,
        template: fieldTemplate
      };
      formSchema['filename'] = {
        title: 'Option 2: Name',
        key: 'filename',
        type: 'TextArea',
        template: fieldTemplate
      };
      formSchema['contents'] = {
        title: 'Option 2: Contents',
        key: 'contents',
        type: 'TextArea',
        template: fieldTemplate
      };
      formSchema['comments'] = {
        title: 'Comments',
        key: 'comments',
        validators: ['required'],
        type: 'TextArea',
        template: fieldTemplate
      };

      var FormFields = Backbone.Model.extend({
        schema: formSchema,
        validate: function(attrs){
          console.log('form validate', attrs);
          var errs = {};
          var file = $('input[name="fileInput"]')[0].files[0]; 
          if (file) {
            if (!_.isEmpty(attrs.contents)){
              console.log('error, multiple file uploads specified');
              errs.contents = 'Specify either file or contents, not both';
            }
          } else {
            if (_.isEmpty(attrs.contents)){
              errs.contents = 'Specify either file or contents';
            }else{
              if (_.isEmpty(attrs.filename)){
                errs.filename = 'Must specify a filename with the file contents';
              }
            }
          }
          if (!_.isEmpty(errs)) return errs;
        }
      });
      var formFields = new FormFields();
      var form = new Backbone.Form({
        model: formFields,
        template: _.template(form_template)
      });
      var _form_el = form.render().el;

      var dialog = appModel.showModal({
          okText: 'upload',
          ok: function(e){
            e.preventDefault();
            var errors = form.commit({ validate: true }); // runs schema and model validation
            if(!_.isEmpty(errors) ){
              console.log('form errors, abort submit: ',errors);
              _.each(_.keys(errors), function(key){
                $('[name="'+key +'"').parents('.form-group').addClass('has-error');
              });
              return false;
            }else{
              var values = form.getValue();
              var comments = values['comments'];
              var headers = {};
              headers[appModel.HEADER_APILOG_COMMENT] = comments;
              
              var data = new FormData();
              _.each(_.keys(values), function(key){
                data.append(key,values[key])
              });

              var file = $('input[name="fileInput"]')[0].files[0];
              var filename;
              if(file){
                data.append('attached_file',file);
                filename = file.name;
                if(!_.isEmpty(values['filename'])){
                  filename = values['filename'];
                }
              }else{
                filename = values['filename'];
              }
              
              var url = [self.model.resource.apiUri, 
                         self.model.key,
                         'attachedfiles'].join('/');
              $.ajax({
                url: url,    
                data: data,
                cache: false,
                contentType: false,
                processData: false,
                type: 'POST',
                headers: headers, 
                success: function(data){
                  attachedfileCollection.fetch({ reset: true });
                  appModel.showModalMessage({
                    title: 'Attached File uploaded',
                    okText: 'ok',
                    body: '"' + filename + '"'
                  });
                },
                done: function(model, resp){
                  // TODO: done replaces success as of jq 1.8
                  console.log('done');
                },
                error: appModel.jqXHRError
              });
            
              return true;
            }
          },
          view: _form_el,
          title: 'Upload an Attached File'  });
      
    },
    
    setUserChecklistItems: function(delegateStack) {
      var self = this;
      var key = 'userchecklistitem';
      var resource = appModel.getResource('userchecklistitem');
      var url = [self.model.resource.apiUri, 
                 self.model.key,
                 'checklistitems'].join('/');

      var show_save_button = $([
        '<a class="btn btn-default btn-sm pull-down" ',
          'role="button" id="save_button" href="#">',
          'save</a>'
        ].join(''));
      var form_template = [
         "<form  class='form-horizontal container' >",
         "<div data-fields='comments'/>",
         "</form>"];
      var altFieldTemplate =  _.template('\
        <div class="form-group" > \
            <label class="control-label col-sm-2" for="<%= editorId %>"><%= title %></label>\
            <div class="col-sm-10" >\
              <div data-editor  style="min-height: 0px; padding-top: 0px; margin-bottom: 0px;" />\
              <div data-error class="text-danger" ></div>\
              <div><%= help %></div>\
            </div> \
          </div>\
        ');
      // Build the form model
      var FormFields = Backbone.Model.extend({
        schema: {
          comments: {
            title: 'Comments',
            key: 'comments',
            type: 'TextArea',
            validators: ['required'], 
            template: altFieldTemplate
          }
        }
      });
      var formFields = new FormFields();
      var form = new Backbone.Form({
        model: formFields,
        template: _.template(form_template.join(''))
      });
      var _form_el = form.render().el;
      
      var PostCollection = Backbone.Collection.extend({
        url: url,
        toJSON: function(){
          return {
            objects: Collection.__super__.toJSON.apply(this) 
          };
        }
      });
      var changedCollection = new PostCollection();
      var MyModel = Backbone.Model.extend({
        url: url,
        initialize : function() {
          this.on('change', function(model, options) {
            // Prevent save on update
            if (options.save === false)
                return;
            model.url = url;
            if(_.isEmpty(model.get('status_date'))){
              model.set('status_date', Iccbl.getISODateString(new Date()));
            }
            if(_.isEmpty(model.get('admin_username'))){
              model.set('admin_username', appModel.getCurrentUser().username);
            }
            changedCollection.add(model);
            appModel.setPagePending();
          });
        },
      });

      var Collection = Iccbl.MyCollection.extend({
        url: url
      });
      collection = new Collection({
        url: url,
      });
      collection.model = MyModel;

      show_save_button.click(function(e){
        e.preventDefault();
        console.log('changed collection', changedCollection,changedCollection.url);
        
        if(changedCollection.isEmpty()){
          appModel.error('No changes to save');
          return;
        }
        
        appModel.showModal({
          okText: 'ok',
          ok: function(e){
            e.preventDefault();
            
            appModel.clearPagePending();
            
            var errors = form.commit();
            if(!_.isEmpty(errors)){
              console.log('form errors, abort submit: ' + JSON.stringify(errors));
              return false;
            }else{
              var values = form.getValue();
              console.log('form values', values);
              var comments = values['comments'];
              var headers = {};
              headers[appModel.HEADER_APILOG_COMMENT] = comments;
              
              Backbone.sync("patch",changedCollection,
                {
                  headers: headers,
                  error: function(){
                    appModel.jqXHRError.apply(this,arguments);
                    console.log('error, refetch', arguments);
                    changedCollection.reset();
                    collection.fetch({ reset: true });
                  },
                }
              );
            }
          },
          view: _form_el,
          title: 'Save changes?'  
        });
      });
        
      view = new ListView({ options: {
        uriStack: _.clone(delegateStack),
        schemaResult: resource.schema,
        resource: resource,
        url: url,
        collection: collection,
        extraControls: [show_save_button]
      }});
      Backbone.Layout.setupView(view);
      self.consumedStack = [key]; 
      self.reportUriStack([]);
      self.listenTo(view , 'uriStack:change', self.reportUriStack);
      self.setView("#tab_container", view ).render();
    },
    
  });

  return UserView;
});