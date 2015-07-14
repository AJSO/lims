/**
 * Library form/view
 */
define([
  'jquery',
  'underscore',
  'backbone',
  'iccbl_backgrid',
  'layoutmanager',
  'models/app_state',
  'views/library/libraryCopy', 
  'views/library/libraryWells', 
  'views/library/libraryVersions',
  'views/generic_detail_layout',
  'views/generic_edit',
  'views/list2',
  'text!templates/generic-tabbed.html'
], function($, _, Backbone, Iccbl, layoutmanager, appModel, LibraryCopyView, 
            LibraryWellsView, LibraryVersionsView,
            DetailLayout, EditView, ListView, 
            libraryTemplate) {
  
  var LibraryView = Backbone.Layout.extend({
    
    initialize: function(args) {
      var self = this;
      this.tabViews = {}; // view cache
      this.uriStack = args.uriStack;
      this.consumedStack = [];
      
      _.each(_.keys(this.tabbed_resources), function(key){
        if(key !== 'detail' && !appModel.hasPermission(self.tabbed_resources[key].resource)){
          delete self.tabbed_resources[key];
        }
      });
      _.bindAll(this, 'click_tab');
      _.bindAll(this, 'saveFile');
    },
    
    template: _.template(libraryTemplate),

    tabbed_resources: {
      detail: { 
        description: 'Library Details', 
        title: 'Library Details', 
        invoke: 'setDetail'
      },
      copy: { 
        description: 'Copies', title: 'Copies', invoke: 'setCopies',
        resource: 'librarycopy'
      },
      plate: { 
        description: 'Plates', title: 'Plates', invoke: 'setPlates' ,
        resource: 'librarycopyplate'
      },
      well: { 
        description: 'Well based view of the library contents', 
        title: 'Wells', invoke: 'setWells' ,
        resource: 'well'
      },
      version: { 
        description: 'Library contents version', 
        title: 'Versions', invoke: 'setVersions' ,
        resource: 'librarycontentsversion'
      }
    },      
    
    events: {
        'click ul.nav-tabs >li': 'click_tab',
        'click button#upload': 'upload'        
    },
    
    upload: function(event){
      appModel.showModal({
          ok: this.saveFile,
          body: '<input type="file" name="fileInput" />',
          title: 'Select a SDF file to upload'  });
    },
    
    saveFile: function() {
      var file = $('input[name="fileInput"]')[0].files[0]; 
      var data = new FormData();
      var url = _.result(this.model, 'url') + '/well';
      // NOTE: 'sdf' is sent as the key to the FILE object in the upload.
      // We are using this as a non-standard way to signal the upload type to the 
      // serializer. (TP doesn't support mulitpart uploads, so this is patched in).
      data.append('sdf', file);
      //      data.append('file', file, {'Content-type': 'chemical/x-mdl-sdfile'});
      //      data.append('Content-type','chemical/x-mdl-sdfile');
      var headers = {};
      headers[appModel.HEADER_APILOG_COMMENT] = self.model.get('comment');
      $.ajax({
        url: url,    
        data: data,
        cache: false,
        contentType: false,
        processData: false,
        type: 'PUT',
        headers: headers, 
        success: function(data){
          // FIXME: should be showing a regular message
          appModel.error('success');
          // FIXME: should reload the library view to reflect new comments/etc.
        },
        done: function(model, resp){
          // TODO: done replaces success as of jq 1.8
          console.log('done');
        },
        error: appModel.jqXHRFail
      });
    },

    /**
     * Child view bubble up URI stack change event
     */
    reportUriStack: function(reportedUriStack) {
      var consumedStack = this.consumedStack || [];
      var actualStack = consumedStack.concat(reportedUriStack);
      this.trigger('uriStack:change', actualStack );
    },
    
    /**
     * Layoutmanager hook
     */
    serialize: function() {
      return {
        'tab_resources': this.tabbed_resources
      }      
    }, 
    
    /**
     * Layoutmanager hook
     */
    afterRender: function(){
      var viewId = 'detail';
      if (!_.isEmpty(this.uriStack)){
        viewId = this.uriStack.shift();
        if (viewId == '+add') {
          this.uriStack.unshift(viewId);
          this.showAdd();
          return;
        }else if (viewId == 'edit'){
          this.uriStack.unshift(viewId);
          this.showEdit();
          return;
        }

        if (!_.has(this.tabbed_resources, viewId)){
          var msg = 'could not find the tabbed resource: ' + viewId;
          appModel.error(msg);
          throw msg;
        }
      }
      this.change_to_tab(viewId);
    },
    
    click_tab : function(event){
      event.preventDefault();
      // Block clicks from the wrong elements
      // TODO: how to make this specific to this view? (is it still also catching
      // clicks on the table paginator?)
      var key = event.currentTarget.id;
      if(_.isEmpty(key)) return;
      this.change_to_tab(key);
    },

    change_to_tab: function(key){
      if(_.has(this.tabbed_resources, key)){
        this.$('li').removeClass('active');
        this.$('#' + key).addClass('active');
        if(key !== 'detail'){
          this.consumedStack = [key];
        }else{
          this.consumedStack = [];
        }
        var delegateStack = _.clone(this.uriStack);
        this.uriStack = [];
        var method = this[this.tabbed_resources[key]['invoke']];
        if (_.isFunction(method)) {
          method.apply(this,[delegateStack]);
        } else {
          throw "Tabbed resources refers to a non-function: " + this.tabbed_resources[key]['invoke']
        }
      }else{
        var msg = 'Unknown tab: ' + key;
        appModel.error(msg);
        throw msg;
      }
    },
    
    showAdd: function() {
      var self = this;
      var delegateStack = _.clone(this.uriStack);
      var view = new DetailLayout({
        model: self.model,
        uriStack: delegateStack
      });
      Backbone.Layout.setupView(view);

      // NOTE: have to re-listen after removing a view
      self.listenTo(view , 'uriStack:change', self.reportUriStack);
      this.setView("#tab_container", view ).render();
      this.$('li').removeClass('active');
      this.$('#detail').addClass('active');
    },
    
    showEdit: function() {
      var self = this;
      var delegateStack = _.clone(this.uriStack);
      var view = new DetailLayout({
        model: self.model,
        uriStack: delegateStack, 
        buttons: ['download', 'upload']
      });
      Backbone.Layout.setupView(view);

      // NOTE: have to re-listen after removing a view
      self.listenTo(view , 'uriStack:change', self.reportUriStack);
      this.setView("#tab_container", view ).render();
      this.$('li').removeClass('active');
      this.$('#detail').addClass('active');
    },
    
    setDetail: function(delegateStack) {
      var key = 'detail';
      
      var view = this.tabViews[key];
      if ( !view ) {
        view = new DetailLayout({ 
          model: this.model,
          uriStack: delegateStack, 
          buttons: ['download', 'upload'] });
        this.tabViews[key] = view;
      } 
      // NOTE: have to re-listen after removing a view
      this.listenTo(view , 'uriStack:change', this.reportUriStack);
      // NOTE: if subview doesn't report stack, report it here
      //      this.reportUriStack([]);
      this.setView("#tab_container", view ).render();
    },

    setVersions: function(delegateStack) {
      // FIXME: this is old, remove
      
      var self = this;
      var key = 'version';
      var view = this.tabViews[key];
      if ( !view ) {
        var view = new LibraryVersionsView({
          library: self.model,
          uriStack: delegateStack
        });
        self.tabViews[key] = view;
        Backbone.Layout.setupView(view);
      } else {
        self.reportUriStack([]);
      }
      // NOTE: have to re-listen after removing a view
      self.listenTo(view , 'uriStack:change', self.reportUriStack);
      this.setView("#tab_container", view ).render();
    },

    setWells: function(delegateStack) {
      var self = this;
      var key = 'well';
      var view = new LibraryWellsView({
        library: self.model,
        uriStack: delegateStack
      });
      self.tabViews[key] = view;
      Backbone.Layout.setupView(view);
      self.reportUriStack([]);
      // NOTE: have to re-listen after removing a view
      self.listenTo(view , 'uriStack:change', self.reportUriStack);
      this.setView("#tab_container", view ).render();
    },

    setPlates: function(delegateStack) {
      var self = this;
      var copyPlateResource = appModel.getResource('librarycopyplate'); 

      // List view
      // special url because list is a child view for library
      var url = [self.model.resource.apiUri, 
                 self.model.key,
                 'plate'].join('/');
      view = new ListView({ options: {
        uriStack: _.clone(delegateStack),
        schemaResult: copyPlateResource.schema,
        resource: copyPlateResource,
        url: url
      }});
      Backbone.Layout.setupView(view);
      self.reportUriStack([]);
      self.listenTo(view , 'uriStack:change', self.reportUriStack);
      this.setView("#tab_container", view ).render();
    },

    setCopies: function(delegateStack) {
      var self = this;
      // Note, no longer caching view; if user clicks on it then refresh
      // var key = 'copy';
      // var view = this.tabViews[key];
      // if ( !view ) {
        
      // FIXME: UI Architecture: 
      // should either:
      // 1. show List view for copies query,
      // 2. or employ the the LibraryCopy (detail) view in the content space:
      var copyResource = appModel.getResource('librarycopy'); 
      
      // List or detail?
      // List: check for list args, or empty
      
      // TODO: allow LibraryCopy model to be provided, with an empty uriStack?
      // (this facilitates in-memory model sharing)
      // (prefer: not to do this, rather, implement model caching on the app-state,
      //  - needs cache-busting technique as well)
      
      if(!_.isEmpty(delegateStack) && !_.isEmpty(delegateStack[0]) &&
          !_.contains(appModel.LIST_ARGS, delegateStack[0]) ){
        // Detail view
        var copyname = delegateStack.shift();
        self.consumedStack.push(copyname);
        var _key = [self.model.key,copyname].join('/');
        appModel.getModel(copyResource.key, _key, function(model){
          view = new LibraryCopyView({
            model: model, 
            uriStack: _.clone(delegateStack),
            library: self.model
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
        // special url because list is a child view for library
        var url = [self.model.resource.apiUri, 
                   self.model.key,
                   'copy'].join('/');
        view = new ListView({ options: {
          uriStack: _.clone(delegateStack),
          schemaResult: copyResource.schema,
          resource: copyResource,
          url: url
        }});
        Backbone.Layout.setupView(view);
        //self.tabViews[key] = view;
        self.reportUriStack([]);
        // NOTE: have to re-listen after removing a view
        self.listenTo(view , 'uriStack:change', self.reportUriStack);
        this.setView("#tab_container", view ).render();
      }
    },

    onClose: function() {
      // TODO: is this necessary when using Backbone LayoutManager
      this.tabViews = {};
      this.remove();
    }
  
  });
  
  return LibraryView;
});