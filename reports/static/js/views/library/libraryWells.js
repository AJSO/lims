define([
  'jquery',
  'underscore',
  'backbone',
  'layoutmanager',
  'iccbl_backgrid',
  'models/app_state',
  'views/list2',
  'views/generic_detail_layout',
  'views/library/library',
  'views/library/libraryWell',
  'utils/treeSelector',
  'templates/genericResource.html'
], 
function($, _, Backbone, layoutmanager, Iccbl, appModel, ListView, DetailLayout, 
         LibraryView, LibraryWellView, TreeSelector, layout) {
  
  var LibraryWellsView = Backbone.Layout.extend({
    
    template: _.template(layout),
    
    initialize: function(args) {
      this.args = args;
      this.library = args.library;
      this.resource = appModel.cloneResource(args.resource);
      console.log('LibraryWellsView: ' + args.resource.key);
      this.uriStack = args.uriStack;
    },
    
    /**
     * Child view bubble up URI stack change event
     */
    reportUriStack: function(reportedUriStack) {
      var consumedStack = this.consumedStack || [];
      var actualStack = consumedStack.concat(reportedUriStack);
      this.trigger('uriStack:change', actualStack );
    },
    
    afterRender: function(){
      this.showList(this.uriStack);
    },     
    
    showDataColumnsDialog: function(listView){
      var self = this;
      
      var searchHash = listView.collection.listModel.get(appModel.URI_PATH_SEARCH);
      var dc_ids = _.result(searchHash,'dc_ids', '');
      if (dc_ids){
        if (!_.isArray(dc_ids)){
          dc_ids = dc_ids.split(',')
        }
        dc_ids = _.map(dc_ids, function(dc_id){ return parseInt(dc_id); });
      }
      console.log('showDataColumnsDialog', dc_ids);
      var resource = appModel.getResource('datacolumn');
      var data_for_get = { 
        limit: 0,
        includes: [
          'screen_facility_id','screen_title','name','description',
          'assay_data_type','ordinal','study_type'],
        order_by: ['screen_facility_id', 'ordinal'],
        use_vocabularies: false
      };
      
      if (self.resource.key == 'silencingreagent'){
        data_for_get['screen_type'] = 'rnai';
      } else {
        data_for_get['screen_type'] = 'small_molecule';
      }
      
      var CollectionClass = Iccbl.CollectionOnClient.extend({
        url: resource.apiUri,
        modelId: function(attrs) {
          return Iccbl.getIdFromIdAttribute( attrs, resource);
        }
      });
      var collection = new CollectionClass();
      collection.fetch({
        data: data_for_get,
        success: function(collection, response) {
          // NOTE: filter for user_access_level_granted > 1; users may only
          // add other screen columns for mutually shared or full access screens
          // NOTE: query filtering, e.g. user_access_level_granted__gt=1 
          // is not available for the DataColumn resource.
          // NOTES:
          // access level_1 - only granted for level 2 screens that are overlapping,
          // - or for level 2 users viewing overlapping level 1 screens; this 
          // class of access is not available on well search because must only be
          // used in the context of a screen result
          // access level 2 - shared mutually, and public screens
          // access level 3 - own screens, or if current user is an admin
          
          collection = new CollectionClass(collection.filter(function(dc){
            return dc.get('user_access_level_granted') > 1;
          }));
          
          showTreeSelector(collection);
        },
        always: function(){
          console.log('done: ');
        }
      }).fail(function(){ 
        Iccbl.appModel.jqXHRfail.apply(this,arguments); 
      });        

      function showColumns(dcs_selected) {
        var fields = self.resource.fields;
        var grid = listView.grid;
        
        console.log('show columns', dcs_selected);
        
        _.each(dcs_selected, function(dc){
          var key = dc.get('key');
          var name = dc.get('title');
          var dc_id = dc.get('data_column_id');
          var field = dc.attributes;
          
          if (dc.get('user_access_level_granted') > 1){
            field['filtering'] = true;
            field['ordering'] = true;
          } else {
            throw 'data column should not appear in this search: ' + key
              + ': user_access_level_granted:' + dc.get('user_access_level_granted'); 
          }
          
          if (!_.has(fields, key)){
            fields[key] = field;
          }

          var column = grid.columns.findWhere({ name: key });
          if (!column){
            var index = grid.columns.size();
            grid.insertColumn(
              Iccbl.createBackgridColumn(
                  key,field,
                  listView.listModel.get('order')),
                  { at: index});
          } else {
            console.log('column already included', key)
          }
        });
        
        var dc_ids_selected = _.map(dcs_selected, function(dcmodel){
          return dcmodel.get('data_column_id');
        });
        // remove unselected
        _.each(dc_ids, function(former_dc_id){
          if (!_.contains(dc_ids_selected,former_dc_id)){
            var column = grid.columns.find(function(gridCol){
              var fi = gridCol.get('fieldinformation');
              if (fi){
                return fi['data_column_id'] == former_dc_id;
              }
            });
            if (!column){
              console.log('column already not present', former_dc_id)
            } else {
              grid.removeColumn(column);
            }
          }
        });
        var searchHash = _.clone(
          listView.collection.listModel.get(appModel.URI_PATH_SEARCH));
        searchHash['dc_ids'] = dc_ids_selected;
        listView.collection.listModel.set(appModel.URI_PATH_SEARCH, searchHash);
        
      }; // showColumns
      
      
      function showTreeSelector(collection){
        console.log('showTreeSelector', dc_ids);
        collection.each(function(model){
          var dc_id = model.get('data_column_id');
          if (_.contains(dc_ids, dc_id)){
            model.set('checked', true);
          }
          model.set('screen_info',
            model.get('screen_facility_id') + ' - ' + model.get('screen_title'));
        });
        
        var show_positives_control = $([
          '<label class="checkbox-inline pull-left" ',
          '   title="Show positive columns only" >',
          '  <input type="checkbox">positives',
          '</label>'
          ].join(''));
        
        var show_studies_control = $([
          '<label class="checkbox-inline pull-left" ',
          '   title="Show study annotations" >',
          '  <input type="checkbox">show studies',
          '</label>'
          ].join(''));
        
        var OtherColumnsTreeSelector = TreeSelector.extend({
          search: function(){
            var show_pos_only = 
              show_positives_control.find('input[type="checkbox"]').prop('checked');
            var show_studies = 
              show_studies_control.find('input[type="checkbox"]').prop('checked');
            var searchedModels;
            if (!_.isEmpty(this.getSearchVal())){
              searchedModels = OtherColumnsTreeSelector.__super__.search.apply(this,arguments);
            } else if (show_pos_only || show_studies ) {
              searchedModels = this.collection.models;
            } else{
              this.clearSearch();
              return;
            }
            searchedModels = _.filter(searchedModels, function(model){
              var shown = true;
              if (shown && show_pos_only){
                shown = model.get('positives_count')>0;
              }
              if (shown && show_studies){
                shown = !_.isEmpty(model.get('study_type'));
              }
              return shown;
            });
            return searchedModels;
          }
        });
        
        var dcView = new OtherColumnsTreeSelector({
          collection: collection,
          treeAttributes: ['screen_info', 'title'],
          treeAttributesForTypeAhead: ['screen_info'],
          extraControls: [show_positives_control, show_studies_control]
        });

        show_positives_control.find('input[type="checkbox"]').change(function(e) {
          var searchedModels = dcView.search();
          if (e.target.checked || !_.isEmpty(searchedModels)) {
            collection.trigger('searchChange', searchedModels);
          }
        });
        show_studies_control.find('input[type="checkbox"]').change(function(e){
          var searchedModels = dcView.search();
          if (e.target.checked || !_.isEmpty(searchedModels)) {
            collection.trigger('searchChange', searchedModels);
          }
        });
        
        Backbone.Layout.setupView(dcView);
  
        var el = dcView.render().el;
        var dialog = appModel.showModal({
            buttons_on_top: true,
            css: { 
                display: 'table',
                height: '500px',
                width: '80%'
              },
            css_modal_content: {
              overflow: 'hidden'
            },
            ok: function(){
              showColumns(dcView.getSelected());
            },
            view: el,
            title: 'Select Screen and Study Columns to display'
        });
      }; // showTreeSelector
      
      
    },

    showList: function(delegateStack) {
      var self = this;

      function createReagentView(schemaResult) {

        var collection = new Iccbl.MyCollection();
        
        // Update the current resource and fields:
        // - current resource prop and field definitions override the new 
        // definitions, if defined, but the new fields are used if not.
        var newFields = _.extend({}, schemaResult['fields'], self.resource['fields'])
        var newResource = _.extend({}, schemaResult, self.resource );
        
        newResource['fields'] = newFields;
        var url = self.resource.apiUri;
        if (self.args.url){
          url = self.args.url;
        }
        if (newResource.key == 'compound_search'){
          url += '/compound_search';
        }
        
        if (!_.isEmpty(_.intersection(delegateStack, 
              [appModel.URI_PATH_COMPLEX_SEARCH,appModel.URI_PATH_ENCODED_SEARCH]))){
          console.log('encoded or complex search found');
          newResource['options']['rpp'] = '24';
        }
        
        var extraControls = [];
        var show_data_columns_control = $([
          '<button class="btn btn-default btn-sm pull-right" role="button" ',
          'id="show_data_columns_control" title="Show study and screen data columns" >',
          'Select Study and Screen Columns',
          '</button>'
          ].join(''));
        show_data_columns_control.click(function(e){
          self.showDataColumnsDialog(view);
        });
        extraControls.push(show_data_columns_control);

        ///////////////////////////////////////////////////////////
        // Override the well link and provide next/previous buttons
        
        // Utility to find item index in collection
        function findIndex(targetModel){
          return collection.findIndex(function(model){
              return targetModel.get('well_id')==model.get('well_id');
            });
        };
        
        function showWell(newIndex){

          var newModel = collection.at(newIndex);
          newModel.resource = newResource;
          console.log('found next model', newModel.get('well_id'));

          var backToSearchButton = $([
            '<a class="btn btn-default btn-sm" ',
               'title="Back to search',
              'role="button" id="button-search" href="#">',
              'Back to Search</a>'
            ].join(''));
    
          var prevButton = $([
            '<a class="btn btn-default btn-sm" ',
               'title="Previous searched well',
              'role="button" id="button-prev" href="#">',
              '<</a>'
            ].join(''));
          var firstButton = $([
            '<a class="btn btn-default btn-sm" ',
               'title="First searched well',
              'role="button" id="button-first" href="#">',
              '<<</a>'
            ].join(''));
          var lastButton = $([
            '<a class="btn btn-default btn-sm" ',
               'title="last searched well',
              'role="button" id="button-last" href="#">',
              '>></a>'
            ].join(''));
          var nextButton = $([
            '<a class="btn btn-default btn-sm" ',
               'title="Next searched well',
              'role="button" id="button-next" href="#">',
              '></a>'
            ].join(''));
          firstButton.click(function(e){
            e.preventDefault();
            collection.getFirstPage().done(function(){
              showWell(0);
            });
          });
          lastButton.click(function(e){
            e.preventDefault();
            collection.getLastPage().done(function(){
              showWell(collection.size()-1);
            });
          });
          nextButton.click(function(e){
            e.preventDefault();
            var index = findIndex(newModel);
            var newIndex = index+1;
            if (collection.size()<=newIndex){
              if (collection.hasNextPage()){
                collection.getNextPage().done(function(){
                  showWell(0);
                });
              } else {
                collection.getFirstPage().done(function(){
                  showWell(0);
                });
              }
            } else {
              showWell(newIndex);
            }
          });
          
          prevButton.click(function(e){
            e.preventDefault();
            var index = findIndex(newModel);
            var newIndex = index-1;
            if (newIndex<0){
              if (collection.hasPreviousPage()){
                collection.getPreviousPage().done(function(){
                  showWell(collection.size()-1);
                });
              } else {
                collection.getLastPage().done(function(){
                  showWell(collection.size()-1);
                });
              }
            } else {
              showWell(newIndex);
            }
          });
          
          function showButtons($el){
            $el.show();
            var titleDiv = $el.find('#content_title').parent();
            titleDiv.find('#search_context_title').remove();
            var search_context_title = $('<h4 id="search_context_title"></h4>');

            search_context_title.append(firstButton);
            search_context_title.append('&nbsp;');
            search_context_title.append(prevButton);
            search_context_title.append('&nbsp;');
            search_context_title.append('Well: ' + newModel.get('well_id') );
            var absIndex = collection.state.pageSize * (collection.state.currentPage -1 )+ newIndex +1;
            search_context_title.append('&nbsp;(' + absIndex + ' of ' + collection.state.totalRecords + ')');
            search_context_title.append('&nbsp;');
            search_context_title.append(nextButton);
            search_context_title.append('&nbsp;');
            search_context_title.append(lastButton);
            search_context_title.append('&nbsp;');
            if (!_.isEmpty(_.intersection(delegateStack, 
                  [appModel.URI_PATH_COMPLEX_SEARCH,appModel.URI_PATH_ENCODED_SEARCH]))){
              search_context_title.append(backToSearchButton);
            }
            titleDiv.append(search_context_title);
          };
          
          var LWView = LibraryWellView.extend({
            afterRender: function(){
              LibraryWellView.prototype.afterRender.apply(this,arguments);
              showButtons(self.$el.find('#content_title_row'));
            }
            
          });
          var lwView = new LWView({
            model: newModel, 
            uriStack: [],
          });
          Backbone.Layout.setupView(lwView);
          self.consumedStack = [newModel.get('well_id')];
          self.listenTo(lwView , 'uriStack:change', self.reportUriStack);
          self.setView("#resource_content", lwView ).render();
          backToSearchButton.click(function(e){
            e.preventDefault();
            self.consumedStack = [];
            var titleDiv = self.$('#content_title').parent();
            titleDiv.find('#search_context_title').remove();
            
            self.showList(delegateStack);
          });
        };
        
        
        newResource['fields']['well_name'].backgridCellType = 
          Iccbl.LinkCell.extend(_.extend({},
            newResource['fields']['well_name'].display_options,
            {
              linkCallback: function(e){
                e.preventDefault();
                showWell(findIndex(this.model));
              }
            }));

        ///////////////////////////////////////////////////////////
        
        var WellListView = ListView.extend({
          afterRender: function(){
            ListView.prototype.afterRender.apply(this,arguments);
            this.$('#list_controls').append(show_data_columns_control);
            return this;
          }
        });
        self.listenTo(collection, 'sync', function(e){
          if (collection.size() == 1 && collection.state.currentPage == 1){
            // show library well view
            var well = collection.at(0);
            var libraryResource = appModel.getResource('library');
            var _route = ['#', libraryResource.key, well.get('library_short_name'),
                          'well', well.get('well_id')].join('/');
            appModel.set('routing_options', {replace: false});  
            appModel.router.navigate(_route, {trigger:true});
          }
        });
        var viewArgs = _.extend({},self.args,{
          resource: newResource,
          collection: collection,
          url: url
        });

        var view = new WellListView(viewArgs);
        self.listenTo(view, 'update_title', function(val) {
          if(val) {
            self.$('#content_title').html(newResource.title + ': <small>' + val + '</small>');
            self.$el.find('#content_title_row').show();
          } else {
//            self.$('#content_title').html(newResource.title);
          }
        });
        self.listenTo(view , 'uriStack:change', self.reportUriStack);
        Backbone.Layout.setupView(view);
        self.setView('#resource_content', view ).render();
        
      };
      
      // Parse the delegateStack to determine if extra data columns are specified
      var listOptions = ListView.prototype.parseUriStack(delegateStack);
      console.log('parsed listOptions', listOptions);
      var dc_ids = [];
      if (_.has(listOptions, appModel.URI_PATH_SEARCH)){
        if (_.has(listOptions.search,'dc_ids')){
          dc_ids = listOptions.search.dc_ids;
          if (dc_ids.length > 0 && _.isString(dc_ids)){
            dc_ids = dc_ids.split(',');
          }
        }
      }
      dc_ids = _.map(dc_ids, function(dc_id){ return parseInt(dc_id); });
      console.log('dc_ids', dc_ids);
      if (!_.isEmpty(dc_ids)){
        // Re-fetch the schema if extra data columns are specified
        var options = {};
        options['dc_ids'] = dc_ids;
        var schemaUrl = [self.resource.apiUri,'schema'].join('/');
        appModel.getResourceFromUrl(schemaUrl, createReagentView, options);
      } else {
        // 20180320 - only get the schema if it is not in the initialize args
        createReagentView(self.resource);
      }
    }
    
  });

  return LibraryWellsView;
});