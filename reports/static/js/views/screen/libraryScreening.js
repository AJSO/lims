define([
  'jquery',
  'underscore',
  'backbone',
  'backgrid',
  'iccbl_backgrid',
  'layoutmanager',
  'models/app_state',
  'utils/plateRangeTable',
  'views/screen/plateRangeSearch',
  'views/generic_detail_layout', 
  'views/generic_detail_stickit', 
  'views/generic_edit',
  'views/list2',
  'utils/tabbedController'
], function($, _, Backbone, Backgrid, Iccbl, layoutmanager, appModel, 
            PlateRangePrototype, PlateRangeSearchView, DetailLayout, 
            DetailView, EditView, ListView, TabbedController) {

  /**
   * LibraryScreening
   */
  var LibraryScreeningView = TabbedController.extend({
  
    initialize: function(args) {
      var self = this;
      this.screen = args.screen;
      
      self.args = args;
      this._classname = 'LibraryScreeningView';

      var fields = self.model.resource.fields;
      self.library_plate_parser = null; 
      if (!_.has(fields,'library_plates_screened')
          || !_.has(fields['library_plates_screened'],'regex')){
        console.log('error: field missing/regex for library_plates_screened',
          self, fields);
        appModel.error('field schema missing/regex for library_plates_screened');
      }else{
        var lcp_regex_string = fields['library_plates_screened']['regex'];
        try{
          lcp_regex = RegExp(lcp_regex_string);
          self.library_plate_parser = _.partial(
            PlateRangePrototype._parse_library_plate_entry,lcp_regex);
        }catch(e){
          appModel.error(
            'regex misconfigured for "library_plates_screened" in metadata: ' 
            + lcp_regex_string);
        }
      }
      
      TabbedController.prototype.initialize.apply(this,arguments);
      
      if (_.isUndefined(this.screen)){
        appModel.getModel('screen', this.model.get('screen_facility_id'), 
          function(screen){
            self.screen = screen;
          });
      } else {
        if (this.screen.get('facility_id') != this.model.get('screen_facility_id')){
          throw "Wrong screen: " + this.screen.get('facility_id') + " for this Cherry Pick Request";
        }
      }
      
      console.log('libraryScreening initialized');
      
      _.bindAll(this, 'setDetail');
      
    },

    local_tabbed_resources: {
      detail: { 
        description: 'Details', 
        title: 'Details', 
        invoke: 'setDetail'
      },
      plates: {
        description : 'Plates Screened',
        title : 'Plates Screened',
        invoke : 'setPlatesScreened',
        permission: 'libraryscreening'
      },
      libraries: {
        description : 'Libraries Screened',
        title : 'Libraries Screened',
        invoke : 'setLibrariesScreened',
        permission: 'libraryscreening'
      },
            
    },      
    
    /**
     * Layoutmanager hook
     */
    serialize: function() {
      var self = this;

      this.tabbed_resources = _.extend({},this.local_tabbed_resources);
      
      return {
        'base_url': self.model.resource.key + '/' + self.model.key,
        'tab_resources': this.tabbed_resources
      }      
    }, 

    getTitle: function() {
      return Iccbl.formatString(
        '<H4 id="title">Library Screening Visit: <a href="#screen/{screen_facility_id}/' + 
        'summary/libraryscreening/{activity_id}" >{activity_id}</a>' +
        '</H4>',
        this.model);
    },
        
    setPlatesScreened: function(delegateStack) {
      var self = this;
      var url = [self.model.resource.apiUri,self.model.key,'plates'].join('/');
      var resource = appModel.getResource('librarycopyplate');
      
      var fields_to_show = [
            'library_short_name', 'library_screening_status',
            'library_comment_array','plate_number',
            'copies_screened', 'comment_array', 'screening_count','assay_plate_count',
            'first_date_screened','last_date_screened'];
      
      var copies_screened_field = _.clone(resource.fields['copy_name']);
      copies_screened_field['visibility'] = ['l'];
      copies_screened_field['data_type'] = 'list'
      copies_screened_field['key'] = 'copies_screened';
      copies_screened_field['title'] = 'Copies Screened';
      copies_screened_field['description'] = 'Copies screened for this plate';
      delete resource.fields['copy_name']
      resource.fields['copies_screened'] = copies_screened_field;

      _.each(_.keys(resource.fields), function(key){
        var field = resource.fields[key];
        if (_.contains(fields_to_show, key)){
          field.ordinal = -fields_to_show.length + _.indexOf(fields_to_show,key);
        } else {
          delete resource.fields[key];
        }
      });
      resource.id_attribute = ['plate_number'];
      resource.title = 'Plates Screened';
      
      resource.fields['library_short_name']['backgridCellType'] =
        Iccbl.CommentArrayLinkCell.extend({
          comment_attribute: 'library_comment_array',
          title_function: function(model){
            return 'Comments for library: ' + model.get('library_short_name');
          }
        });
      
      resource.fields['plate_number']['backgridCellType'] =
        Iccbl.CommentArrayLinkCell.extend({
          comment_attribute: 'comment_array',
          title_function: function(model){
            return 'Comments for Plate: ' 
              + model.get('library_short_name') + '/' 
              + model.get('copy_name')  + '/'
              + model.get('plate_number');
          },
          get_link_stack: function(){
            var newUriStack = [
              'library',this.model.get('library_short_name'),
              'plate', appModel.URI_PATH_SEARCH];
            var search = {};
            search['copy_name__in'] = this.model.get('copies_screened');
            newUriStack.push(appModel.createSearchString(search));
            return newUriStack;
          },
          get_href: function(){
            var uriStack = this.get_link_stack();
            return '#' + uriStack.join('/');
          },
          linkCallback: function(e){
            e.preventDefault();
            appModel.setUriStack(this.get_link_stack());
          }
        });
      
      resource.fields['screening_count'].backgridCellType = 
        Iccbl.LinkCell.extend(_.extend({},
          resource.fields['screening_count'].display_options,
          {
            get_link_stack: function(){
              var newUriStack = [
                'screen',self.model.get('screen_facility_id'),
                'summary','libraryscreening', appModel.URI_PATH_SEARCH];
              var search = {};
              var plate_number = this.model.get('plate_number');
              search['library_plates_screened__contains'] = _.map(
                this.model.get('copies_screened'), function(copy_name){
                  return plate_number + '/' + copy_name;
                }).join(';');
              newUriStack.push(appModel.createSearchString(search));
              return newUriStack;
            },
            get_href: function(){
              var uriStack = this.get_link_stack();
              return '#' + uriStack.join('/');
            },
            linkCallback: function(e){
              e.preventDefault();
              appModel.setUriStack(this.get_link_stack());
            }
          }));
      
      
      var view = new ListView({ 
        uriStack: _.clone(delegateStack),
        resource: resource,
        url: url,
        extraControls: []
      });
      Backbone.Layout.setupView(view);
      self.listenTo(view , 'uriStack:change', self.reportUriStack);
      self.setView("#tab_container", view ).render();

    },
    
    setLibrariesScreened: function(delegateStack) {
      var self = this;
      var url = [self.model.resource.apiUri,self.model.key,'libraries'].join('/');
      var resource = appModel.getResource('library');
      resource.options = {};
      var includes = resource.options.includes = [];
      var fields = resource['fields'];
      var visible_fields = ['short_name','library_name','experimental_well_count',
                            'provider', 'screen_type', 'library_type',
                            'is_pool', 'start_plate', 'end_plate', 
                            'screening_status', 'date_screenable'];
      _.each(_.keys(fields),function(fieldkey){
        if (!_.contains(visible_fields,fieldkey)){
          fields[fieldkey]['visibility'] = [];
        }else{
          if (!_.contains(fields[fieldkey]['visibility'],'l')){
            fields[fieldkey]['visibility'] = ['l'];
            includes.unshift(fieldkey);
          }
          fields[fieldkey].ordinal = -visible_fields.length + _.indexOf(visible_fields,fieldkey);
        }
      });
      
      console.log('includes', includes);
      resource.fields['short_name']['backgridCellType'] =
        Iccbl.CommentArrayLinkCell.extend({
          comment_attribute: 'comment_array',
          title_function: function(model){
            return 'Comments for library: ' + model.get('short_name');
          }
        });
      
      var view = new ListView({ 
        uriStack: _.clone(delegateStack),
        resource: resource,
        url: url,
        extraControls: [],
      });
      Backbone.Layout.setupView(view);
      self.listenTo(view , 'uriStack:change', self.reportUriStack);
      self.setView("#tab_container", view ).render();
      self.listenTo(view, 'afterRender', function(event) {
      });
    },
    
    setDetail: function(delegateStack) {
      console.log('detail view');
      
      var self = this;
      var key = 'detail';
      var buttons = ['download'];
      if (appModel.hasPermission('libraryscreening', 'write')){
        buttons = buttons.concat(['history','edit']);
      }

      var url = _.result(self.model,'url');
     
      // TODO: create a LibraryScreeningDetailView subclass of DetailLayout
      var detailView = DetailView.extend({
        
        afterRender: function(){
          
          DetailView.prototype.afterRender.apply(this,arguments);
          
          var plate_collection = new Backbone.Collection;
          plate_collection.comparator = 'start_plate';
          plate_collection.set(
            _.map(self.model.get('library_plates_screened'),self.library_plate_parser));
          PlateRangePrototype._createPlateRangeTable.call(
            this,plate_collection, this.$el.find('#library_plates_screened'));

          if (appModel.hasPermission('libraryscreening', 'write')){
            var add_another_button = $([
              '<button class="btn btn-default btn-sm " role="button" ',
              'id="add_another_ls_button" title="Add another library screening visit" >',
              'Add another library screening visit',
              '</button>'
              ].join(''));
            $('#generic-detail-buttonpanel-left').append(add_another_button);
            add_another_button.click(function(e){
              var uriStack = ['screen', self.screen.key,
                              'summary','libraryscreening','+add'];
              console.log('route: ', uriStack);
              appModel.setUriStack(uriStack);
            });
          }
          // Removed: 20170407 - JAS/KR
          // Assay Protocol not needed
          //if(!_.isEmpty(self.model.get('assay_protocol'))){
          //  $target_el = this.$el.find('#assay_protocol_last_modified_date');
          //  var apilogResource = appModel.getResource('apilog');
          //  var options = {
          //    data_for_get: {
          //      limit: 1,
          //      key: self.model.get('activity_id'),
          //      ref_resource_name: self.model.resource.key,
          //      diff_keys__icontains: '"assay_protocol"',
          //      order_by: ['-date_time']
          //    }
          //  };
          //  Iccbl.getCollectionOnClient(apilogResource.apiUri,function(collection){
          //    if(collection && !collection.isEmpty()){
          //      var model = collection.at(0);
          //      console.log('assay_protocol_last_modified_date',model.get('date_time'));
          //      self.model.set('assay_protocol_last_modified_date',model.get('date_time'));
          //    }else{
          //      // no apilog found, set it to the creation date
          //      self.model.set('assay_protocol_last_modified_date',
          //        self.model.get('date_created'));
          //    }
          //  },options);
          //}
        
        }
      });
      
      var editView = EditView.extend({
        
        overrides_granted: {},

        save_success: function(data, textStatus, jqXHR){
          // 20180912 - no need to display (kls4)
          //var meta = _.result(data, 'meta', null);
          //if (meta) {
          //  appModel.showJsonMessages(meta);
          //}

          if (! this.model.isNew()){
            var key = Iccbl.getIdFromIdAttribute( this.model,this.model.resource );
            appModel.router.navigate([
                self.screen.resource.key,self.screen.key,
                'summary/libraryscreening',key].join('/'), 
              {trigger:true});
          } else { 
            appModel.router.navigate([
                self.screen.resource.key,self.screen.key,
                'summary/libraryscreening'].join('/'), 
              {trigger:true});
          }
        },
        
        /**
         * Override save to handle library overrides
         */
        save: function(changedAttributes, options){
          var inner_self = this;
          var options = options || { headers: {} };
          var comment = _.result(options.headers,appModel.HEADER_APILOG_COMMENT);
          this.model.save(changedAttributes, options)
            .done(function(data, textStatus, jqXHR){ 
              appModel.clearPagePending();
              inner_self.save_success.apply(this,arguments);
            })
            .fail(function(jqXHR, textStatus, errorThrown) { 
              /// "not allowed" libraries require an "override" param
              /// see cherryPickRequest.js
              console.log('errors', arguments);
              
              // REMOVED: 20170412: 
              // MODIFIED: 20170605 - allow insufficient volume; warn only
              // per JAS/KR; raise error, no override allowed for insufficient volume
              var jsonError = _.result(jqXHR, 'responseJSON');
              if (!_.isUndefined(jsonError)){
                var error = _.result(jsonError, 'errors');
                var libraryErrorFlag = _.result(error,appModel.API_PARAM_OVERRIDE);
                // MODIFIED: 20170605 - allow insufficient volume; warn only
                // per JAS/KR; raise error, no override allowed for insufficient volume
                var volumeErrorFlag = _.result(error,appModel.API_PARAM_VOLUME_OVERRIDE)
                if (!_.isUndefined(libraryErrorFlag)){
                  var title = _.result(error, 'library_plates_screened');
                  if (!title){
                    console.log('Error: expecting "library_plates_screened" error message');
                    title = 'Override required for libraries that are not "allowed"';
                  }
                  var bodyMsg = 'Not allowed libraries';
                  var errors = _.result(error, 'Libraries');
                  if (!errors){
                    console.log('Libraries should be reported in the response');
                  }else{
                    bodyMsg = 'Libraries: ' + errors.join(', ');
                  }
                  appModel.showOkCommentForm({
                    title: title,
                    body: bodyMsg,
                    okText: 'Confirm Override',
                    ok: function(formValues) {
                      inner_self.overrides_granted[appModel.API_PARAM_OVERRIDE] = 'true';
                      self.model.url = function(){
                        var new_url = url + '?' + _.map(_.pairs(inner_self.overrides_granted),
                          function(keyval){
                            return keyval.join('=');
                          }).join('&')
                        return new_url;
                      };
                      var new_comment = formValues['comments']
                      if (new_comment){
                        if (comment){
                          comment += '; ' + new_comment;
                        } else {
                          comment = new_comment
                        }
                        options.headers[appModel.HEADER_APILOG_COMMENT] = comment;
                        console.log('new comments', comment);
                      }
                      inner_self.save(changedAttributes, options);
                    }
                  });
                // REMOVED: 20170412: 
                // MODIFIED: 20170605 - allow insufficient volume; warn only
                // per JAS/KR; raise error, no override allowed for insufficient volume
                //} else if (!_.isUndefined(volumeErrorFlag)){
                } else {
                  inner_self.save_fail.apply(this,arguments);
                }
              } else {
                inner_self.save_fail.apply(this,arguments);
              }
            });
        },
        
        afterRender: function(){

          EditView.prototype.afterRender.apply(this,arguments);

          console.log('libraryScreening.editView afterRender...');
          var self_editform = this;

          var screenResource = appModel.getResource('screen')
          var urlparts = [screenResource.apiUri,
                          self.screen.get('facility_id'),
                          'plate_range_search']
          urlparts.push(self.model.get('activity_id'));
          var url = urlparts.join('/');
          
          var Collection = Iccbl.CollectionOnClient.extend({
            // explicitly define the id so that collection compare & equals work
            modelId: function(attrs) {
              return Iccbl.formatString( Iccbl.PLATE_RANGE_KEY_SPECIFIER, attrs);
            }
          });
          var plate_collection = new Collection({
          });
          var localRemovedCollection = new Collection();
          var localAddedCollection = new Collection();
          plate_collection.comparator = 'start_plate';
          this.listenTo(plate_collection, "MyCollection:delete", function (model) {
            plate_collection.remove(model);
            if (model.get('library_screening_id') > 0){
              localRemovedCollection.add(model);
            }
            localAddedCollection.remove(model);
          });
          this.listenTo(plate_collection,'add', function(model){
            localAddedCollection.add(model);
            localRemovedCollection.remove(model);
            model.collection = plate_collection; // backbone bug: this should not be necessary
          });
          this.listenTo(plate_collection, 'update', function (plate_collection) {
            self_editform.setValue('library_plates_screened', 
              plate_collection.map(function(model){
                return Iccbl.formatString(Iccbl.PLATE_RANGE_KEY_SPECIFIER, model);
              }));
          });
          
          if (self.model.get('activity_id')){
            plate_collection.url = url;
            plate_collection.fetch().done(function(data){
              PlateRangePrototype._createPlateRangeTable.call(this,
                plate_collection, self.$el.find('[key="library_plates_screened"]'), 
                true, ['-library_screening_id','-plate_locations',
                       'library_screening_status','warnings','errors']);
              plateRangeSearch();
            });
          } else {
            //lps = [];
            //plate_collection.set(_.map(lps,self.library_plate_parser));
            PlateRangePrototype._createPlateRangeTable.call(this,
              plate_collection, self.$el.find('[key="library_plates_screened"]'), 
              true, ['-library_screening_id', '-plate_locations', 
                     'library_screening_status', 'warnings','errors']);
            plateRangeSearch();
          }
          
          function plateRangeSearch(){
            // create the search form
            var TextArea2 = Backbone.Form.editors.TextArea.extend({
              render: function() {
                TextArea2.__super__.render.apply(this,arguments);
                this.$el.attr('placeholder', 'Enter Plate Number ranges, followed by the Copy Name');
                return this;
              },        
            });
            var formSchema = {};
            function validatePlateSearch(value, formValues){
              var errors = [];
              var final_search_array = Iccbl.parseRawPlateSearch(value,errors);
              if (_.isEmpty(final_search_array)){
                errors.push('no values found for input');
              } else {
                console.log('final_search_array', final_search_array);
              }
              // Library screening search specific:
              _.each(final_search_array, function(search_line){
                var is_error = false;
                if (_.isEmpty(search_line.copies)){
                  errors.push('must specify a copy: ' + search_line.combined.join(', '))
                  is_error = true;
                }else if (search_line.copies.length > 1){
                  errors.push('only one copy per line: found: ["' 
                    + search_line.copies.join('","') + '"]');
                  is_error = true;
                }
                if (_.isEmpty(search_line.plates)&&_.isEmpty(search_line.plate_ranges)){
                  errors.push('must specify a plate or plate-range: ' 
                    + search_line.combined.join(', ') );
                  is_error = true
                }
                
                if(is_error != true){
                  // search for overlapping ranges with extant ranges
                  // expected ranges
                  var copy_name = search_line.copies[0];
                  var plate_ranges = [];
                  _.each(search_line.plates, function(plate){
                    plate_ranges.push([plate,plate]);
                  });
                  _.each(search_line.plate_ranges, function(range){
                    plate_ranges.push(range.split('-'));
                  });
                  _.each(plate_ranges, function(range){
                    plate_collection.each(function(extantModel){
                      if (extantModel.get('copy_name') == copy_name){
                        var start = extantModel.get('start_plate');
                        var end = extantModel.get('end_plate');
                        if( (range[0] >= start && range[0] <= end)
                            || (range[1] >= start && range[1] <= end)) {
                          errors.push(
                            'Plate Range is overlapping: ' 
                            + range[0] + '-' + range[1] + ' ' + copy_name 
                            + ', first remove the existing range, then re-enter the new range.'); 
                        }
                      }
                    });
                  });
                }
              });
              if (!_.isEmpty(errors)) {
                return {
                  type: 'plate_search',
                  message: errors.join('; ')
                };
              }
            };
            formSchema['plate_search'] = {
              key: 'plate_search',
              editorClass: 'input-full form-control',
              validators: ['required', validatePlateSearch],
              type: TextArea2,
              template: appModel._field_template
            };
            
            var FormFields = Backbone.Model.extend({
              schema: formSchema
//              validate: function(attrs) {
//                var errs = {};
//                if (!_.isEmpty(errs)) return errs;
//              }
            });
            var formFields = new FormFields();
            var form = new Backbone.Form({
              model: formFields,
              template: _.template([
                '<div>',
                '<form class="form" >',
                '<div data-editors="plate_search"></div>',
                '<div id="plate_search_error" class="text-danger"></div>',
                '</form>',
                '</div>'
                ].join(''))
            });
            
            var $form = form.render().$el;
            self.$el.find('[key="library_plates_screened"]').append($form);
            $form.append([
                '<button type="submit" ',
                'class="btn btn-default btn-sm controls-right" " >Add plate ranges</input>',
                ].join(''));

            // Begin, optional screening inquiry form
            if (appModel.DEBUG && appModel.getCurrentUser().is_superuser) {
              var showScreeningInquiryButton = $([
                '<a class="btn btn-default btn-sm pull-down controls-right" ',
                  'role="button" target="_blank" ', 
                  'id="show_screening_inquiry_link" ',
                  'title="Use the Screening Inquiry form to search for available plate copies" ',
                  'href="#">',
                  'Show the screening inquiry form...</a>'
                ].join(''));
              $form.append(showScreeningInquiryButton);
              showScreeningInquiryButton.click(function(e){
                // see search_box.js
                var searchData = {
                  screen_facility_id: self.model.get('screen_facility_id')
                };
                var num_replicates = self_editform.getValue('number_of_replicates');
                var vol_to_assayplates  = self_editform.getValue(
                  'volume_transferred_per_well_to_assay_plates');
                var plate_search = form.getValue('plate_search');
                if (vol_to_assayplates){
                  
                  searchData['volume_required'] = vol_to_assayplates;
                  searchData['replicate_count'] = num_replicates;
                }
                if(plate_search){
                  var errors = [];
                  var plate_ranges = Iccbl.parseRawPlateSearch(plate_search, errors);
                  if (!_.isEmpty(errors)){
                    console.log('plate search has errors', errors);
                  } else if (!_.isEmpty(plate_ranges)){
                    searchData['plate_ranges'] = plate_ranges;
                  }
                  var urlSearchParts = 
                    PlateRangeSearchView.prototype.encodeFormData.call(this,searchData);
                  var uriStack = ['#screen', self.model.get('screen_facility_id'),
                                  'summary','plateranges',appModel.URI_PATH_SEARCH,
                                  urlSearchParts.join(appModel.SEARCH_DELIMITER)];
                  e.target.href = uriStack.join('/')
                }
              });
            } // End, optional screening inquiry form
            
            form.$el.find('[ type="submit" ]').click(function(e){
              e.preventDefault();
              var errors = form.commit({ validate: true }); 
              if(!_.isEmpty(errors)){
                form.$el.find('#plate_search').addClass("has-error");
                form.$el.find('#plate_search_error').html(errors['plate_search'].message);
                return;
              }else{
                form.$el.find('#plate_search_error').empty();
                form.$el.find('#plate_search').removeClass("has-error");
              }

              var search_value = form.getValue('plate_search');
              console.log('search_value', search_value);
              
              var data = new FormData();
              data.append(appModel.API_PARAM_SEARCH, search_value);
              data.append(
                'volume_required', 
                self_editform.getValue('volume_transferred_per_well_from_library_plates'));
              // NOTE: show_retired_plates is required for searching
              data.append('show_retired_plates','true');
              var headers = {}; // can be used to send a comment
              $.ajax({
                url:  url,     
                data: data,
                cache: false,
                contentType: false,
                processData: false,
                dataType: 'json', // what is expected back from the server
                type: 'POST',
              }).done(function(data, textStatus, jqXHR){
                console.log('success', data);

                var meta = _.result(data,appModel.API_RESULT_META, {});
                var warning = _.result(meta, appModel.API_META_MSG_WARNING);
                if (warning){
                  appModel.showJsonMessages(
                    _.pick(meta,appModel.API_META_MSG_WARNING));
                  return;
                }else{
                  var objects = _.result(data, appModel.API_RESULT_DATA);
                  if (!_.isEmpty(objects)){
                    // The plate_range_search API utility will return all 
                    // plate ranges for the screen; filter out the ranges for the
                    // other screenings.
                    
                    var activity_id = self.model.get('activity_id');
                    objects = _.filter(objects, function(object){
                      var returned_id = _.result(object,'library_screening_id');
                      if (returned_id == 0){
                        return true;
                      }else if (returned_id == activity_id){
                        return true;
                      }
                      return false;
                    });
                    var newCollection = new Collection(objects);
                    newCollection.remove(localRemovedCollection.toArray());
                    newCollection.add(localAddedCollection.toArray());
                    plate_collection.set(newCollection.toArray());
                  }
                  form.setValue('plate_search', null);
                }
              }).fail(function(jqXHR, textStatus, errorThrown) { 
                console.log('errors', arguments);
                appModel.jqXHRfail.apply(this,arguments); 
              });
            });
          }

          var plates = self.model.get('library_plates_screened');
          if ( _.isEmpty(plates)){
            // attach is_for_external_library_plates change listener
            this.listenTo(this, "is_for_external_library_plates:change", 
              function(e){
                var $target_el = self_editform.$el.find(
                  '[key=form-group-library_plates_screened]');
                var val = self_editform.getValue(
                  'is_for_external_library_plates');
                console.log('is_for_external_library_plates:',val)
                if(val){
                  $target_el.hide();
                  self_editform.setValue('library_plates_screened',null);
                } else {
                  $target_el.show();
                } 
            });
            // 20170416 - Do not allow edit for
            // "volume_transferred_per_well_from_library_plates"
            // attach listener volume calculator
            function calculateVolFromLibraryPlates(){
              var errors = self_editform.commit({ validate: true }); 
              var num_replicates = self_editform.getValue('number_of_replicates');
              var vol_to_assayplates  = self_editform.getValue(
                'volume_transferred_per_well_to_assay_plates');
              console.log('calculateVolFromLibraryPlates', 
                num_replicates, vol_to_assayplates, errors);
              if(errors && !_.isEmpty(errors['number_of_replicates']) 
                  || vol_to_assayplates <= 0){
                console.log('cannot calculate volume until form values are entered');
                self_editform.setValue(
                  'volume_transferred_per_well_from_library_plates',null);
                self.model.unset(
                  'volume_transferred_per_well_from_library_plates');
                self_editform.fields
                  .volume_transferred_per_well_from_library_plates.editor.render();
              } else {

                var calculated = num_replicates * vol_to_assayplates;
                self_editform.setValue(
                  'volume_transferred_per_well_from_library_plates',calculated);
                self.model.set(
                  'volume_transferred_per_well_from_library_plates',
                  calculated);
                self_editform.fields
                  .volume_transferred_per_well_from_library_plates.editor.render();
              
              }
            };
            //var calcVolButton = $([
            //  '<button class="btn btn-default btn-sm" ',
            //    'role="button" id="calc_volume_transferred_per_well_from_library_plates" href="#">',
            //    'Calculate</button>'
            //  ].join(''));
            //self_editform.$el.find(
            //  '[key=form-group-volume_transferred_per_well_from_library_plates]'
            //  ).append(calcVolButton);
            //calcVolButton.click(function(event){
            //  event.preventDefault();
            //  calculateVolFromLibraryPlates();
            //});
            this.listenTo(
              this, "number_of_replicates:change", calculateVolFromLibraryPlates);
            this.listenTo(
              this, "volume_transferred_per_well_to_assay_plates:change", 
              calculateVolFromLibraryPlates);
          }
        }
      });
      
      var DetailLayoutLS = DetailLayout.extend({
        afterRender: function(){
          DetailLayout.prototype.afterRender.apply(this,arguments);
        },
        showEdit: function() {
          var self = this;
          appModel.initializeAdminMode(function(){
            var fields = self.model.resource.fields;
            fields['performed_by_user_id'].choiceHash = 
              appModel._get_screen_member_choices(self.screen);
            fields['performed_by_username']['editability'] = [];
            fields['serviced_user_id']['editability'] = [];
            fields['serviced_username']['editability'] = [];
            fields['screen_facility_id']['editability'] = [];
            fields['library_plates_screened'].display_options = _.extend(
              {}, fields['library_plates_screened'].display_options, 
              {widthClass: 'col-sm-8'});
            fields['library_plates_screened'].validators = [
              function checkPlates(value, formValues) {
                if (formValues['is_for_external_library_plates'] !== true ){
                  if (! value){
                    return {
                      type: 'Required',
                      message: 'Required'
                    }
                  }
                }
              }];

            if (!self.model.isNew()){
              // allow the library_plates_screened to be unset
              fields['library_plates_screened'].required = false;
              fields['library_plates_screened'].regex = null;
              var plates = self.model.get('library_plates_screened');
              if ( !_.isEmpty(plates)){
                var msg = '(all plates must be removed to edit) '
                _.each([
                  'is_for_external_library_plates',
                  'volume_transferred_per_well_to_assay_plates',
                  'volume_transferred_per_well_from_library_plates',
                  'number_of_replicates'],
                  function(disallowed_field){
                    fields[disallowed_field]['required'] = false;
                    fields[disallowed_field]['editability'] = [];
                    fields[disallowed_field]['description'] = 
                      msg + fields[disallowed_field]['description'];
                  }
                );
              }
            }
            
            // 20170416 - per JAS, turn off UI editability for volxfer field
            fields['volume_transferred_per_well_from_library_plates'].editability = [];
            DetailLayout.prototype.showEdit.apply(self,arguments);
          });  
        }
        
      });
      
      self.model.resource.fields['screen_facility_id']['visibility'] = [];
      
      if (this.model.get('is_for_external_library_plates') === true){
        _.each(['library_plates_screened','screened_experimental_well_count',
            'libraries_screened_count','library_plates_screened_count'] ,
          function(key){
            self.model.resource.fields[key]['visibility']=[];
        });
      }
      
      // FIXME: 20170519, pick needed values only from the args 
      view = new DetailLayoutLS(_.extend(self.args, { 
        model: this.model,
        uriStack: delegateStack, 
        buttons: buttons,
        EditView: editView,
        DetailView: detailView
      }));
      this.tabViews[key] = view;
      this.listenTo(view , 'uriStack:change', this.reportUriStack);
      this.setView("#tab_container", view ).render();

    }, // end setDetail

    
    /** Backbone.layoutmanager callback **/
    cleanup: function(){
      console.log('cleanup called...');
      this.model = null;
      this.screen = null;
      this.args = null;
      this.tabbed_resources = null;
    }    
  
  });
  
  return LibraryScreeningView;
});