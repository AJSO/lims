
define([
    'jquery',
    'underscore',
    'backbone',
    'templates/generic-collection-columns.html',
], function($, _, Backbone, collectionColumnsTemplate) {

  /**
   * Show an in memory collection as a series of columns rather than rows.
   */
  var CollectionView = Backbone.View.extend({

    initialize : function(attributes, options) {
      console.log('initialize CollectionColumns view');
      var self = this;
      this.options = options;
      Iccbl.assert(
          !_.isUndefined(options.resource), 
          'collection view requires a "resource" schema option');
      Iccbl.assert(
          !_.isUndefined(options.router), 'collection view requires a router');
      Iccbl.assert(
          !_.isUndefined(options.collection), 'collection view requires a collection');

      headers = [];
      rows = [];
      this.attributeKeys = Iccbl.sortOnOrdinal(
          _.keys(options.resource.fields), options.resource.fields);
      var resource_definition = self.options.resource;
      options.collection.each(function(model){
          headers.push(
              Iccbl.getTitleFromTitleAttribute(model, self.options.resource));
      });
      headers.unshift(
          self.options.resource['title']);
      _.each(
          this.attributeKeys, 
            function(key){
              var attributeTitle = self.options.resource.fields[key]['title'];
              if(_.isUndefined(attributeTitle)) attributeTitle = key;
              row = [{ value: attributeTitle} ]
              self.options.collection.each(function(model){
                  row.push( {value: model.get(key)} );
              });
              rows.push(row);
            });

      var data = {
          headers: headers, rows: rows,
          caption: resource_definition['description']
          };

      var compiledTemplate = this.compiledTemplate = _.template( collectionColumnsTemplate, data );
    },

    render : function() {
      var self = this;
      this.$el.html(this.compiledTemplate);
      return this;
    },
  });

  return CollectionView;
});