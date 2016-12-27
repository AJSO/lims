define([
  'jquery',
  'underscore',
  'backgrid',
  'iccbl_backgrid',
  'models/app_state',
  'templates/genericResource.html'
], 
function($, _, Backgrid, Iccbl, appModel, genericLayout) {
  

  var WellColumnSelectorHeader = Backgrid.HeaderCell.extend({
    
    /** @property */
    events: {
      "click": "cellClicked",
      "click input[type=checkbox]": "cellClicked"
    },

    initialize : function(options) {
    
      var self = this;
      WellColumnSelectorHeader.__super__.initialize.apply(this, arguments);
      
      this.listenTo(this.collection, "select-column", function (colNumber, selected) {
        var colNumber = parseInt(colNumber);
        self.collection.each(function(model){
          model.set(colNumber, selected);
        });
      });
      
      var colNumber = parseInt(this.column.get('name'));
      
      this.listenTo(this.collection, 'change:' + colNumber, function(){
        var hasFalse = self.collection.find(function(model){
          return model.get(colNumber)===false;
        });
        var selected = _.isUndefined(hasFalse);
        self.checkbox().prop('checked', selected);
        if (selected){
          self.$el.addClass('selected')
        } else {
          self.$el.removeClass('selected')
        }
      });
    },
    
    cellClicked: function(e) {
      var checked = this.checkbox().prop("checked");
      checked = !checked;
      this.checkbox().prop("checked", checked);
      this.$el.parent().toggleClass("selected", checked);
      
      // Because the col does not have a state model, fire a select-column event
      this.collection.trigger("select-column", this.column.get('name'), checked);
    
    },

    /**
       Returns the checkbox.
     */
    checkbox: function () {
      return this.$el.find("input[type=checkbox]");
    },
      
    render : function() {
      var self = this;
      WellColumnSelectorHeader.__super__.render.apply(this);
      var columnSelector = $('<input type="checkbox" style="display: none;" >');
      this.$el.prepend(columnSelector);
      return this;
    }
  });
  
  
  /**
   * Modified from Backgrid.Extension.SelectRowCell
   * 
   */
  var RowSelectorCell = Backgrid.Cell.extend({
  
    /** @property */
    className: "wellselector select-row-cell",
  
    /** @property */
    tagName: "td",
  
    /** @property */
    events: {
      "keydown input[type=checkbox]": "onKeydown",
      "change input[type=checkbox]": "onChange",
      "click": "cellClicked",
      "click input[type=checkbox]": "cellClicked"
    },
    
    
    initialize: function(options){
      var self = this;
      this.column = options.column;
      if (!(this.column instanceof Backgrid.Column)) {
        this.column = new Backgrid.Column(this.column);
      }
      
      // TODO: review: code copied from Backgrid.Cell
      // Related to keyboard navigation and displaying editmode for cells
      var column = this.column, model = this.model, $el = this.$el;
      this.listenTo(column, "change:renderable", function (column, renderable) {
        $el.toggleClass("renderable", renderable);
      });
  
      if (Backgrid.callByNeed(column.renderable(), column, model)) $el.addClass("renderable");
      ///////
      
      this.listenTo(model, "select-row", function (model, selected) {
        if (selected) {
          console.log('select row');
          _.each(self.model.keys(), function(key){
            if (key=='row') return;
            self.model.set(key,true);
          });
        } else {
          _.each(self.model.keys(), function(key){
            if (key=='row') return;
            self.model.set(key,false);
          });
          
        }
      });
      
      this.listenTo(model, 'change', function(model, options){
        var isSelected = true;
        _.each(self.model.keys(), function(key){
          if (key=='row') return;
          if (self.model.get(key)===false){
            isSelected = false;
          }
        });
        self.checkbox().prop('checked',isSelected);
        this.$el.parent().toggleClass("selected", isSelected);
      });
    },
    
    /**
       Returns the checkbox.
     */
    checkbox: function () {
      return this.$el.find("input[type=checkbox]");
    },
  
    /**
       Focuses the checkbox.
    */
    enterEditMode: function () {
      this.checkbox().focus();
    },
  
    /**
       Unfocuses the checkbox.
    */
    exitEditMode: function () {
      this.checkbox().blur();
    },
  
    /**
       Process keyboard navigation.
    */
    onKeydown: function (e) {
      var command = new Backgrid.Command(e);
      if (command.passThru()) return true; // skip ahead to `change`
      if (command.cancel()) {
        e.stopPropagation();
        this.checkbox().blur();
      }
      else if (command.save() || command.moveLeft() || command.moveRight() ||
               command.moveUp() || command.moveDown()) {
        e.preventDefault();
        e.stopPropagation();
        this.model.trigger("backgrid:edited", this.model, this.column, command);
      }
    },
  
//    /**
//       When the checkbox's value changes, this method will trigger a Backbone
//       `select-row` event with a reference of the model and the
//       checkbox's `checked` value.
//    */
//    onChange: function () {
//      var checked = this.checkbox().prop("checked");
//      this.$el.parent().toggleClass("selected", checked);
//      
//      // Because the row does not have a state model, fire a select-row event
//      this.model.trigger("select-row", this.model, checked);
//    },        
    
    cellClicked: function(e) {
      var checked = this.checkbox().prop("checked");
      checked = !checked;
      this.checkbox().prop("checked", checked);
      this.$el.parent().toggleClass("selected", checked);
      
      // Because the row does not have a state model, fire a select-row event
      this.model.trigger("select-row", this.model, checked);
    },
    
    /**
       Renders a checkbox in a table cell.
    */
    render: function () {

      this.$el.empty();
      var rowSelector = $('<input tabindex="-1" type="checkbox" style="display: none;" />');
      this.$el.append(rowSelector);
      this.$el.append(Iccbl.rowToLetter(
        parseInt(this.model.get('row'))));
      this.delegateEvents();
      return this;
    }
  });
  
  var WellSelectorCell = Backgrid.Cell.extend({

    
    /** @property */
    tagName: "td",
  
    /** @property */
    className: "wellselector",

    /** @property */
    events: {
      'click': "cellClicked"
    },
    
    initialize: function(options){

      var self = this;
      this.column = options.column;
      
      if (!(this.column instanceof Backgrid.Column)) {
        this.column = new Backgrid.Column(this.column);
      }
      
      // TODO: review: actions copied from Backgrid.Cell initializer
      var column = this.column, model = this.model, $el = this.$el;
      this.listenTo(column, "change:renderable", function (column, renderable) {
        $el.toggleClass("renderable", renderable);
      });
  
      if (Backgrid.callByNeed(column.renderable(), column, model)) $el.addClass("renderable");

      this.listenTo(model, "change:" + column.get("name"), function () {
        this.render();
      });
    
    },
    
    cellClicked: function(e) {
      
      var model = this.model;
      var row = this.model.get('row');
      var columnNumber = parseInt(this.column.get("name"));
      var val = this.model.get(columnNumber);
      console.log('row', row, 'columnNumber', columnNumber, 'val', val, 'model', model);
     
      if (val===false){
        this.model.set(columnNumber, true);
      }else{
        this.model.set(columnNumber, false);
      }
    },
    
    render: function () {
      
      var model = this.model;
      var row = this.model.get('row');
      var columnNumber = parseInt(this.column.get("name"));
      var val = this.model.get(columnNumber);
      
      if (columnNumber < 10) columnNumber = '0' + columnNumber;

      this.$el.empty();
      this.$el.append(Iccbl.rowToLetter(row) + columnNumber);
      if (val===true){
        this.$el.addClass('selected');
      }else{
        this.$el.removeClass('selected');
      }
      return this;
    }
    
  });
  
  var WellSelector = Backbone.Layout.extend({
    
    template: _.template(genericLayout),

    initialize: function(options) {
      
      console.log('initialize wellselector');
      
      var options = options || {};
      
      var plate_size = 384;
      var nCols = this.nCols = options.nCols || 24;
      var nRows = this.nRows = options.nRows || 16;
      
      var wellSelections = options.wellSelections || '';

      var RowModel = Backbone.Model.extend({
        idAttribute: 'row'
      })
      var RowCollection = Backbone.Collection.extend({
        model: RowModel
      });
      
      var rowCollection = this.rowCollection = new RowCollection();
      
      for (var i=0; i<nRows; i++){
        var row = { row: i };
        for (var j=1; j<=nCols; j++){
          row[j] = false;
        }
        rowCollection.add(new RowModel(row));
      };
      
      console.log('wellSelections', wellSelections);
      if (!_.isEmpty(wellSelections)){
        _.each(wellSelections.split(/\s*,\s*/), function(wellSelection){
          var colMatch = wellSelection.match(/col:\s*(\d)/i);
          if (colMatch !== null){
            var col = parseInt(colMatch[1]);
            rowCollection.each(function(rowModel){
              rowModel.set(col,true);
            });
            return;
          }
          var rowMatch = wellSelection.match(/row:\s*([a-zA-Z]{1,2})/i);
          if (rowMatch !== null){
            rowModel = rowCollection.find(function(model){
              if (Iccbl.rowToLetter(model.get('row'))==rowMatch[1].toUpperCase()){
                return true;
              }
              return false;
            });
            if (!_.isUndefined(rowModel)){
              _.each(rowModel.keys(), function(key){
                if (key!=='row'){
                  rowModel.set(key,true);
                }
              });
            }
            return;
          }
          
          var wellMatch = wellSelection.match(/(([a-zA-Z]{1,2})(\d{1,2}))/);
          if (wellMatch != null){
            var row = wellMatch[2].toUpperCase();
            var col = parseInt(wellMatch[3]);
            console.log('set row,', row, 'col', col);
            rowModel = rowCollection.find(function(model){
              if (Iccbl.rowToLetter(model.get('row'))==row){
                return true;
              }
              return false;
            });
            if (!_.isUndefined(rowModel)){
              rowModel.set(col, true);
            }
            return;
          }
          
          throw new Exception('Unknown well selection pattern: "' + wellSelection + '"');
        });
        
        
      }
      
      console.log('initialized...', this.rowCollection);
    },
    
    afterRender: function(){
      var self = this;
      console.log('afterRender grid...', self.rowCollection);
      var colTemplate = {
        'cell' : WellSelectorCell,
        'order' : -1,
        'sortable': false,
        'searchable': false,
        'editable' : true,
        'visible': true,
      };
      var columns = [
        _.extend({},colTemplate,{
          'name' : 'row',
          'label' : '',
          'description' : 'Select Row',
          'order': 1,
          'sortable': false,
          'editable': false,
          'cell': RowSelectorCell
          
        }),
      ];
      for (var i=1; i<=self.nCols; i++){
        columns.push(
          _.extend({},colTemplate,{
            'name' : i,
            'label' : i,
            'description' : 'Column',
            'order': 1,
            'sortable': false,
            'cell': WellSelectorCell,
            'headerCell': WellColumnSelectorHeader
          })
        );
      }
      var colModel = new Backgrid.Columns(columns);
      var _grid = new Backgrid.Grid({
        className: 'wellselector backgrid table-striped table-condensed table-hover', 
        columns: colModel,
        collection: self.rowCollection
      });
      _grid.render();          
      
      $('#resource_content').html(_grid.el);
    },
    
    getSelectedWells: function(){
      var self = this;
      var fullCols = [];
      var fullRows = [];
      var individualWells = [];
      
      self.rowCollection.each(function(rowModel){
        var row = Iccbl.rowToLetter(rowModel.get('row'));
        var isFalse = _.find(rowModel.keys(), function(key){
          return key != 'row' && rowModel.get(key)==false;
        });
        if (_.isUndefined(isFalse)) fullRows.push(row);
      });
      for(var i=1; i<=self.nCols; i++){
        var isFalse = self.rowCollection.find(function(rowModel){
          return rowModel.get(i)==false;
        });
        if (_.isUndefined(isFalse)) fullCols.push(i);
      }
      self.rowCollection.each(function(rowModel){
        var row = Iccbl.rowToLetter(rowModel.get('row'));
        if (!_.contains(fullRows,row)){
          _.each(rowModel.keys(), function(key){
            if (key!=='row' && rowModel.get(key)){
              var columnNumber = parseInt(key);
              if (!_.contains(fullCols, columnNumber)){
                if (columnNumber < 10) columnNumber = '0' + columnNumber;
                var wellName = row + columnNumber;
                individualWells.push(wellName);
              }
            }
          });
        }
      });
      fullRows = _.map(fullRows, function(row){ return 'Row:'+row; });
      fullCols = _.map(fullCols, function(col){ return 'Col:'+col });
      return fullCols.concat(fullRows,individualWells);
    }
    
  });
  
  return WellSelector;
  
});