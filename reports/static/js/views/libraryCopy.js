define([
  'jquery',
  'underscore',
  'backbone',
  'layoutmanager',
  'iccbl_backgrid',
  'models/app_state',
  'views/list2',
  'views/generic_detail_layout',
  'views/library',
  'text!templates/genericResource.html'
], 
function($, _, Backbone, layoutmanager, Iccbl, appModel, ListView, DetailLayout, 
         LibraryView, layout) {
  
  // put the view args in a keyed hash for lookup by name
  var VIEWS = {
    'ListView': ListView, 
    'DetailView': DetailLayout
  };
    
  var LibraryCopyView = Backbone.Layout.extend({
    
    template: _.template(layout),
    
    initialize: function(args) {
      this.views = {}; // view cache
      
      this.uriStack = args.uriStack;
      this.library = args.library;
      
      this.consumedStack = [];
      _.bindAll(this, 'showDetail');
    },
    
    /**
     * Child view bubble up URI stack change event
     */
    reportUriStack: function(reportedUriStack) {
      var consumedStack = this.consumedStack || [];
      var actualStack = consumedStack.concat(reportedUriStack);
      this.trigger('uriStack:change', actualStack );
    },

    // layoutmanager hook
    afterRender: function(){
      var uriStack = this.uriStack;
      var library = this.library;

      var url = library.resource.apiUri +'/' + library.key + '/copy/'
      var libraryCopyResourceId = 'librarycopy';
      var libraryCopyResource = appModel.getResource(libraryCopyResourceId);

      // Test for list args, if not found, then it's a detail view
      if (!_.isEmpty(uriStack) && !_.isEmpty(uriStack[0]) &&
              !_.contains(appModel.LIST_ARGS, uriStack[0]) ) {
        var _key;
        // if in context of library, then only need one item from the stack
        var stackItem = uriStack.shift();
        if(stackItem !== library.key) {
          // assume that it is the copy name
        }else{
          stackItem = uriStack.shift();
        }
        this.consumedStack = [stackItem];
        _key = library.key + '/' + stackItem;

        appModel.getModel(libraryCopyResourceId, _key, this.showDetail );
      } else {
        this.consumedStack = [];
        this.showList(libraryCopyResourceId, libraryCopyResource, url);
      }
    },    
    
    showDetail: function(model) {
      var self = this;
      var uriStack = _.clone(this.uriStack);
      // get the view class
      var viewClass = DetailLayout;
      var view = new viewClass({ model: model, uriStack: uriStack });
      self.listenTo(view , 'uriStack:change', self.reportUriStack);
      self.setView('#content', view).render();
    },
    
    showList: function(uiResourceId, resource, url) {
      var self = this;
      var uriStack = _.clone(this.uriStack);
      
      var createList = function(schemaResult) {
        var view = new ListView({ options: {
          uriStack: uriStack,
          schemaResult: schemaResult,
          resource: resource,
          url: url
        }});
        self.listenTo(view , 'uriStack:change', self.reportUriStack);
        self.listenTo(view, 'detail', function(model) {
          var key = Iccbl.getIdFromIdAttribute(model,schemaResult);
          var keysToReport = Iccbl.getIdKeys(model,schemaResult);
          if(keysToReport[0] = self.library.key){
            keysToReport.shift(); // get rid of the library key part
          }
          self.consumedStack = keysToReport;
          
          appModel.updateModel(uiResourceId,key,model,function(model){
            self.showDetail(model);
          });          
        });
        Backbone.Layout.setupView(view);
        self.setView('#content', view ).render();
      };
      appModel.getSchema(uiResourceId, createList);      
    },
  });

  return LibraryCopyView;
});