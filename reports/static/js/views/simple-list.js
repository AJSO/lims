define([
  'jquery',
  'underscore',
  'backbone',
  'backgrid',
  'iccbl_backgrid',
  'models/app_state',
  'views/generic_selector',
  'templates/simple-list.html',
  'templates/modal_ok_cancel.html'
], function(
    $, _, Backbone, Backgrid, Iccbl, appModel, 
    genericSelector, listTemplate, modalTemplate ){

  var ListView = Backbone.Layout.extend({
    LIST_ROUTE_ORDER: ['rpp', 'page','order',appModel.URI_PATH_SEARCH],

    initialize : function(args) {
        var self = this;
        this.args = args;
        var resource = this.resource = args.resource;
        var schema = this.schema = resource;
        var collection = this.collection = args.collection;
        var includes = args.includes || [];
        var orderStack = args.orderStack || [];
        var columns;
        var data = { message: '' };
        var compiledTemplate = this.compiledTemplate = _.template( listTemplate, data );
        
        
        if (!collection.listModel){
          var ListModel = Backbone.Model.extend({
            defaults: {
                rpp: 25,
                page: 1,
                order: {},
                search: {},
                includes: [] }
            });
          
          var listModel = this.listModel = new ListModel();
          
          collection.listModel = listModel;
        }

        
        this.model = collection.listModel;
        
        if(!args.columns){
          columns = Iccbl.createBackgridColModel(
            schema.fields, 
            orderStack,
            {},
            includes);
        }else{
          columns = args.columns;
        }
        this.objects_to_destroy = _([]);

        console.log('initialize list:' + JSON.stringify(this.args.columns));
        var grid = this.grid = new Backgrid.Grid({
          columns: columns,
          collection: collection,
        });
        grid.$el.addClass("col-sm-12 table-striped table-condensed table-hover");

        this.objects_to_destroy.push(grid);

        // Paginator
        var paginator = self.paginator = new Backgrid.Extension.Paginator({
          collection: self.collection
        });
        this.objects_to_destroy.push(paginator);

        // Extraselector
        if( _.has(schema, 'extraSelectorOptions')){
            var searchHash = self.model.get(appModel.URI_PATH_SEARCH);
            console.log('extraselector init: searchTerms: ' + JSON.stringify(searchHash));

            var extraSelectorModel = new Backbone.Model({ selection: '' });
            var extraSelectorKey = schema.extraSelectorOptions.searchColumn;
            _.each(_.keys(searchHash), function(key){
                console.log('key: ' + key + ', extrSelectorKey: ' + extraSelectorKey);
                if( key == extraSelectorKey){
                    extraSelectorModel.set({ selection: searchHash[key] });
                }
            });
            var extraSelectorInstance = self.extraSelectorInstance =
                new genericSelector({ model: extraSelectorModel } , schema.extraSelectorOptions );
            this.objects_to_destroy.push(extraSelectorInstance);

            this.listenTo(this.model, 'change: search', function(){
                var searchHash = self.model.get(appModel.URI_PATH_SEARCH);
                console.log('extraselector, search changed: ' + JSON.stringify(searchHash));
                _.each(_.keys(searchHash), function(key){
                    console.log('key: ' + key + ', extrSelectorKey: ' + extraSelectorKey);
                    if( key == extraSelectorKey){
                        extraSelectorModel.set({ selection: searchHash[key] });
                    }
                });
            });
            this.listenTo(extraSelectorModel, 'change', function() {
                console.log('===--- extraSelectorModel change');
                var searchHash = _.clone(self.model.get(appModel.URI_PATH_SEARCH));
                var value = extraSelectorModel.get('selection');
                searchHash[extraSelectorKey] = value;
                self.model.set(appModel.URI_PATH_SEARCH, searchHash);
            });
        }


        this.listenTo(
          self.collection, "MyCollection:detail", 
          function (model) {
            try{
              
            } catch (e){
              console.log('caught error: ' + JSON.stringify(e));
              var idList = Iccbl.getIdKeys(model,schema);
              appModel.set({
                current_scratch: { schema: schema, model: model},
              });
              // NOTE: prefer to send custom signal, rather than uriStack:change for 
              // detail/edit; this allows the parent to decide URI signalling
            }
            self.trigger('detail', model);
          });        
        
        this.listenTo(collection,'sync', function(collection){
          if(collection.size()<=collection.listModel.get('rpp')){
            console.log('hide paginator', collection.size(),collection.listModel.get('rpp'));
            self.$("#paginator-div").hide();
          }
        });
        
        console.log('list view initialized');
    },


    remove: function(){
        console.log('ListView remove called');
        Backbone.View.prototype.remove.apply(this);
    },

    onClose: function(){
        console.log('Extra onclose method called');
        if(_.isObject(this.objects_to_destroy)){
            this.objects_to_destroy.each(function(view_obj){
                view_obj.remove();
                view_obj.unbind();
                view_obj.stopListening();
            });
        }
    },

    afterRender: function(){
        var self = this;
        this.$el.html(this.compiledTemplate);
        this.$("#example-table").append(this.grid.render().$el);
        self.$("#paginator-div").append(self.paginator.render().$el);
        if(!_.isUndefined(self.extraSelectorInstance)){
            self.$("#extra-selector-div").append(self.extraSelectorInstance.render().$el);
        }
        var fetched = false;
        if ( !fetched ) {
          var fetchOptions = { reset: false };
          self.collection.fetch(
            fetchOptions
          ).fail(function(){ Iccbl.appModel.jqXHRfail.apply(this,arguments); });      
        }
        this.delegateEvents();
        return this;
    }

  });

  return ListView;
});