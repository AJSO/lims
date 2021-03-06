define(['jquery', 'underscore', 'backbone', 'backgrid','backbone_forms',
        'backgrid_filter', 'backgrid_paginator', 'backgrid_select_all',
        'layoutmanager'],
    function($, _, Backbone, Backgrid, BackboneForms,
             BackgridFilter, BackgridSelectAll, layoutmanager ) {

// NOTE: Webpack 3 patch:
// Bind the Backbone.Layout object (and Backbone.Form) using the webpack
// ProvidePlugin
Backbone.Layout = LayoutManager;
Backbone.Form = BackboneForm;

var root = window;

var Iccbl = root.Iccbl = {
    VERSION : "0.0.1",
    appModel : "This value will be initialized on app start"
};

// Constants

var ICCBL_DATE_RE = Iccbl.ICCBL_DATE_RE =  /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/; // MM/DD/YYYY
var DATE_RE = Iccbl.DATE_RE = /^([+\-]?\d{4})-(\d{2})-(\d{2})$/;
var TIME_RE = Iccbl.TIME_RE = /^(\d{2}):(\d{2}):(\d{2})(\.(\d{3}))?$/;
var ISO_SPLITTER_RE = Iccbl.ISO_SPLITTER_RE = /T|Z| +/;


var SEARCH_LINE_SPLITTING_PATTERN =
  Iccbl.SEARCH_LINE_SPLITTING_PATTERN = /[\n;\|]+/
/**
 * PLATE_COPY_RANGE_SPLITTING_PATTERN
 * Split a raw plate range input into elements:
 * - separated by space or comma, except,
 * - numbers separated by (spaces) and dash interpreted as a plate range
 * - quoted strings preserved; to be interpreted as copy names
 * - quoted strings may contain spaces and special chars if quoted
 */
var PLATE_COPY_RANGE_SPLITTING_PATTERN = Iccbl.PLATE_COPY_RANGE_SPLITTING_PATTERN =
  /\'.*?\'|\".*?\"|\d+\s*\-\s*\d+|[^\,\s]+/g;
var PLATE_PATTERN = Iccbl.PLATE_PATTERN = /^(\d{1,5})$/;
var PLATE_RANGE_PATTERN = Iccbl.PLATE_RANGE_PATTERN = /^(\d+)\s*-\s*(\d+)$/;

var WELL_ID_PATTERN = Iccbl.WELL_ID_PATTERN = /^(\d{1,5}):?(([a-zA-Z]{1,2})(\d{1,2}))$/
var WELL_PATTERN = Iccbl.WELL_PATTERN = /^([a-zA-Z]{1,2})(\d{1,2})$/i;
var COL_PATTERN = Iccbl.COL_PATTERN = /^(col:)?\s*(\d{1,2})$/i;
var ROW_PATTERN = Iccbl.ROW_PATTERN = /^(row:)?\s*([a-zA-Z]{1,2})$/i;

var PLATE_RANGE_KEY_SPECIFIER = Iccbl.PLATE_RANGE_KEY_SPECIFIER
  = '{library_short_name}:{copy_name}:{start_plate}-{end_plate}';
var PLATE_RANGE_KEY_PATTERN =
  Iccbl.PLATE_RANGE_KEY_PATTERN = /^(([^:]*):)?(([^:]+):)?([\d\-]+)$/;
var SHORT_PLATE_RANGE_KEY_PATTERN = Iccbl.SHORT_PLATE_RANGE_KEY_PATTERN
  = /^(([^:]+):)?([\d\-]+)$/;
var COPY_PLATE_RANGE_KEY_PATTERN =
  Iccbl.COPY_PLATE_RANGE_KEY_PATTERN = /^(([^\/]*)\/)?(([^\/]+)\/)?([\d\-]+)$/;


var URI_REPLICATE_VOLUME_PATTERN = /((\d+)x)?(([\d\.]+)(\w|\xB5|\x{03BC})L)/i;
/**
 * COPY_NAME_PATTERN:
 * -must start with an alpha char
 */
var COPY_NAME_PATTERN = Iccbl.COPY_NAME_PATTERN = /^["']?[A-Za-z]+[\w\- :]*["']?$/

// Utility Functions

/**
 * Convert a plate row index to an standard plate layout letter.
 * @param i 0 based row index
 */
var rowToLetter = Iccbl.rowToLetter = function(i){
  if (i<26){
    return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[i];
  } else {
    var rem = i%26;
    var part = parseInt(i/26)-1;
    return rowToLetter(part) + rowToLetter(rem);
  }
};

/**
 * @return 0 based row index for the row letter
 */
var letterToRow = Iccbl.letterToRow = function(rowletter){
  if (rowletter.length == 1){
    return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(rowletter.toUpperCase());
  } else {
    return letterToRow(rowletter.charAt(rowletter.length-1))
      + 26*(letterToRow(rowletter.slice(0,rowletter.length-1))+1)
  }
};

var getRows = Iccbl.getRows = function(plateSize){
  return parseInt(Math.sqrt(2*plateSize/3));
};

var getCols = Iccbl.getCols = function(plateSize){
  return parseInt(Math.sqrt(3*plateSize/2));
};

/**
 * @param row 0 based index
 * @param col - 0 based index
 */
var getWellName = Iccbl.getWellName = function(row, col){
  var wellName = rowToLetter(row);
  col = col+1;
  if ( col<10 ) {
    wellName += '0' + col;
  } else {
    wellName += col;
  }
  return wellName
};

/**
 * @return [row, col] 0 based row and col indexes
 */
var getWellRowCol = Iccbl.getWellRowCol = function(wellName){
  var rowLetter = WELL_PATTERN.exec(wellName)[1];
  var row = letterToRow(rowLetter);
  var col = parseInt(WELL_PATTERN.exec(wellName)[2])-1;
  return [row,col];
}

/**
 * String padding utility
 */
function lpad(str, length, padstr) {
  var paddingLen = length - (str + '').length;
  paddingLen =  paddingLen < 0 ? 0 : paddingLen;
  var padding = '';
  for (var i = 0; i < paddingLen; i++) {
    padding = padding + padstr;
  }
  return padding + str;
}

/**
 * String formatting utility
 *
 * Format a string with embedded replacement fields.
 *
 * "replacment fields" are surrounded by braces '{}'.
 * Each replacement field is used as a key to lookup values in the object.
 *
 * @param object - either a Backbone.Model, or a object
 * @param defaul_val value to use if the matched token is not found in the model
 * - this can be used to replace any token with a given default value
 * - if default_val is not provided, the replacement_field is left in the string.
 * @param clientFilter if provided provides a method for the client function to
 *  wipe the link. This is a temporary hack to clear links for items that the user
 *  does not have access to. 
 */
var formatString = Iccbl.formatString = function(
    stringWithTokens,
    object,
    default_val, clientFilter)
  {
  var isBackboneModel = object instanceof Backbone.Model;
  if (!isBackboneModel){
    if (typeof(object.get)=='function' && _.has(object,'attributes')){
      isBackboneModel = true;
    }
  }
  var clientFilterHit = false;
  var interpolatedString = stringWithTokens.replace(/{([^}]+)}/g,
    function (match)
    {
      match = match.replace(/[{}]/g,'');
      var newVal;
      if(isBackboneModel && !_.isUndefined(object.get(match))){
        newVal = object.get(match);
      }else if(_.has(object, match)){
        newVal =  object[match];
      }else{
        if(!_.isUndefined(default_val)){
          newVal = default_val;
        }else{
          newVal = match;
        }
      }
      if (clientFilter && clientFilter(match, newVal)===true){
        clientFilterHit = true;
      }
      return newVal;
    });
  
  if (clientFilterHit===true) return '#'; 
  
  return interpolatedString;
};

/**
 * Convert a string to a function.
 * @return function instance referred to by the string
 */
var stringToFunction = Iccbl.stringToFunction = function(str) {
  if (!str) return;

  var arr = str.split(".");

  var fn = (window || this);
  for (var i = 0, len = arr.length; i < len; i++) {
    fn = fn[arr[i]];
  }
  if ( typeof fn !== "function") {
    throw new ReferenceError("function not found: " + str);
  }
  return fn;
};


/**
 * Run maxPrecision using appModel.MAX_PRECISION after calculations to round out 
 * floating point math errors.
 */ 
var maxPrecision = Iccbl.maxPrecision = function maxPrecision(number) {
  return (parseFloat(number.toPrecision(Iccbl.appModel.MAX_PRECISION)));
};


/**
 * Round by first converting to whole number, to avoid floating point number
 * arithmetic errors:
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/round
 */
var round = Iccbl.round = function round(number, precision) {
  var shift = function (number, precision, reverseShift) {
    if (reverseShift) {
      precision = -precision;
    }
    var numArray = ("" + number).split("e");
  return +(numArray[0] + "e" + (numArray[1] ? (+numArray[1] + precision) : precision));
  };
  return shift(Math.round(shift(number, precision, false)), precision, true);
};

/**
 * Perform rounding using the defaultUnit precision added to the desired precision:
 * e.g. if defaultUnit is 1e-6, and desired precision is 2 digits, then the 
 * applied precision will be 2+6 = 8 digits.
 */
var roundForDefaultUnit = Iccbl.roundForDefaultUnit = function roundForDefaultUnit(number, precision, defaultUnit){
  // find exponent
  var exponent = Math.floor(Math.log(defaultUnit)/Math.log(10));
  var full_precision = precision - exponent;
  return round(number, full_precision);
};

/**
 * Parse a string date value, ignoring the time and timezone.
 *
 * @return Date
 * TODO: see Backgrid.DateFormatter.convert() method and refactor
 */
var dateParse = Iccbl.dateParse = function dateParse(rawData){

  if (_.isNull(rawData) || _.isUndefined(rawData)) return '';
  rawData = rawData.trim();
  if ((rawData + '').trim() === '') return null;

  if(ICCBL_DATE_RE.test(rawData)){
    var MMDDYYYY = ICCBL_DATE_RE.exec(rawData) || [];
    var jsDate = new Date(
      MMDDYYYY[3] * 1 || 0,
      MMDDYYYY[1] * 1 - 1 || 0,
      MMDDYYYY[2] * 1 || 0);
    if (Iccbl.appModel.DEBUG) {
      console.log('date: raw: ', rawData, 'converted', jsDate);
    }
    return jsDate;
  }else{
    // ISO date format, ignore timezone / time
    var temp = rawData.split(ISO_SPLITTER_RE)[0];
    if(DATE_RE.test(temp)){
      var YYYYMMDD = DATE_RE.exec(temp);
      if (Iccbl.appModel.DEBUG) console.log('YYYYMMDD', YYYYMMDD);
      var jsDate = new Date(YYYYMMDD[1]*1, YYYYMMDD[2]*1-1, YYYYMMDD[3]*1 )
      if (Iccbl.appModel.DEBUG) console.log('date: raw: ', rawData, 'converted', jsDate);
      return jsDate;
    }else{
      throw new Error('unrecognized date: ' + rawData );
    }
  }
};

/**
 * Generate an ISO date string from a JavaScript Date.
 *
 * @param jsDate a JavaScript Date object
 * @return ISO date string for the Date object, ignoring the timezone.
 * - for internal representation of dates and communicating dates to the server.
 */
var getISODateString = Iccbl.getISODateString = function(jsDate){
  return jsDate && _.isDate(jsDate) ? jsDate.toISOString().split('T')[0] : jsDate;
  // equivalent:
  //  date = lpad(jsDate.getUTCFullYear(), 4, 0)
  //    + '-' + lpad(jsDate.getUTCMonth() + 1, 2, 0)
  //    + '-' + lpad(jsDate.getUTCDate(), 2, 0);
  //  return date;
};

/**
 * Generate a date string from a Javascript Date.
 *
 * @param jsDate a JavaScript Date object
 * @return string representation of the Date object, ignoring the timezone.
 * - "ICCBL" format is "MM/DD/YYYY"
 */
var getIccblDateString = Iccbl.getDateString = function(jsDate){

  if (!jsDate) return jsDate;
  if (!_.isDate(jsDate)){
    // attempt to parse the date
    jsDate = Iccbl.dateParse(jsDate);
  }
  return (
      lpad(jsDate.getMonth() + 1, 2, 0)
      + '/' + lpad(jsDate.getDate(), 2, 0)
      + '/' + lpad(jsDate.getFullYear(), 4, 0) );
};

/**
 * Matrix convolution/deconvolution Utilities:
 * - Convolution: converting (96,384) to (384,1536)
 * - Deconvolution: converting (1536,384) to (384,96)
 **/

/**
 * Map (1536,384)-well row,col to (384,96)-well output quadrant
 * @param row 0 based
 * @param col 0 based
 */
var deconvoluteQuadrant = Iccbl.deconvoluteQuadrant = function(source_ps, dest_ps, row, col){

  var factor = source_ps/dest_ps
  if (factor != 4){
    throw 'Deconvolute may only be used for source_ps/dest_ps == 4: ' +
      source_ps + '/' + dest_ps;
  }
  return col%(factor/2) +  (row%(factor/2))*(factor/2);
};

/**
 * Map (1536,384-)well input row to (384-)well output row
 * @param row 0 based
 * @param col 0 based
 */
var deconvoluteRow = Iccbl.deconvoluteRow = function(source_ps, dest_ps,row, col){

  var dest_matrix_number = deconvoluteQuadrant(source_ps, dest_ps, row, col)
  var factor = source_ps/dest_ps
  return Math.trunc(row/(factor/2))+ row%(factor/2)-Math.trunc(dest_matrix_number/(factor/2));
};

/**
 * Map (1536,384)-well input col to (384,96)-well output col
 * @param row 0 based
 * @param col 0 based
 */
var deconvoluteCol = Iccbl.deconvoluteCol = function(source_ps, dest_ps, row, col){

  var dest_matrix_number = deconvoluteQuadrant(source_ps, dest_ps, row, col);
  var factor = source_ps/dest_ps
  return Math.trunc(col/Math.trunc(factor/2))+ col%(factor/2)-dest_matrix_number%(factor/2);
};

/**
 * Map (96,384)-well input row to (384,1536)-well output row
 * @param row 0 based
 * @param col 0 based
 */
var convoluteRow = Iccbl.convoluteRow = function(source_ps, dest_ps, source_matrix_quadrant,row){
  var factor = dest_ps/source_ps;
  if (factor != 4){
    throw 'Convolute may only be used for dest_ps/source_ps == 4: ' +
      dest_ps + '/' + source_ps;
  }
  if (!_.contains([0,1,2,3], source_matrix_quadrant)){
    throw 'source_matrix_quadrant must be 0<=n<4: ' + source_matrix_quadrant;
  }
  return row * factor/2 + Math.trunc(source_matrix_quadrant/(factor/2))
};

/**
 * Map (96,384)-well input col to (384,1536)-well output col
 * @param row 0 based
 * @param col 0 based
 */
var convoluteCol = Iccbl.convoluteCol = function(source_ps, dest_ps, source_matrix_quadrant, col){
  var factor = dest_ps/source_ps;
  if (factor != 4){
    throw 'Convolute may only be used for dest_ps/source_ps == 4: ' +
      dest_ps + '/' + source_ps;
  }
  return col * factor/2 + source_matrix_quadrant%(factor/2)

};

/**
 * Map a well from (96,384) plate format to (384,1536) plate format.
 * returns 4 wells for each quadrant
 */
var convoluteWell = Iccbl.convoluteWell = function(source_ps, dest_ps, wellName){
  var factor = dest_ps/source_ps;
  if (factor != 4){
    throw 'Convolute may only be used for dest_ps/source_ps == 4: ' +
      dest_ps + '/' + source_ps;
  }
  var convolutedWells = [];
  var row_col = Iccbl.getWellRowCol(wellName);
  for (var quadrant = 0;quadrant<factor;quadrant++){
    var newRowIndex = Iccbl.convoluteRow(source_ps,dest_ps,quadrant,row_col[0]);
    var newColIndex = Iccbl.convoluteCol(source_ps,dest_ps,quadrant,row_col[1]);
    convolutedWells.push(Iccbl.getWellName(newRowIndex,newColIndex));
  }
  return convolutedWells;
};

/**
 * Map a list of wells from (96,384) plate format to (384,1536) plate format.
 */
var convoluteWells = Iccbl.convoluteWells = function(source_ps, dest_ps, wells){
  var convolutedWells = [];
  _.each(wells, function(wellName){
    convolutedWells = convolutedWells.concat(convoluteWell(source_ps,dest_ps,wellName));
  });
  if (Iccbl.appModel.DEBUG) {
    console.log('wells convoluted', wells, source_ps,dest_ps, convolutedWells);
  }
  convolutedWells.sort();
  return convolutedWells;
};

/**
 * Map a well from (384,1536) plate format to (96,384) plate format.
 * @return [quadrant, new_wellname]
 **/
var deconvoluteWell = Iccbl.deconvoluteWell = function(source_ps, dest_ps, wellName){
  var row_col = Iccbl.getWellRowCol(wellName);
  var row = row_col[0], col = row_col[1];
  var plateQuadrant = Iccbl.deconvoluteQuadrant(source_ps, dest_ps, row, col);
  var newRowIndex = Iccbl.deconvoluteRow(source_ps, dest_ps, row, col);
  var newColIndex = Iccbl.deconvoluteCol(source_ps, dest_ps, row, col);
  return [plateQuadrant, Iccbl.getWellName(newRowIndex,newColIndex)];
};

/**
 * Map a list of wells from (384,1536) plate format to (96,384) plate format.
 *
 * @return map of the plateQuadrant->deconvolutedWells
 *  where plateQuadrant is in [0,1,2,3]
 */
var deconvoluteWells = Iccbl.deconvoluteWells = function(source_ps, dest_ps, wells){
  var deconvolutedPlateQuadrantWells = {
    0: [], 1:[], 2:[], 3:[]
  };
  if (Iccbl.appModel.DEBUG) console.log('deconvoluteWells...');
  _.each(wells, function(wellName){
    var quadrant_new_well = deconvoluteWell(source_ps,dest_ps, wellName);
    var quadrant = quadrant_new_well[0];
    var newWellname = quadrant_new_well[1];
    deconvolutedPlateQuadrantWells[quadrant].push(newWellname);
  });

  if (Iccbl.appModel.DEBUG){
    console.log('wells deconvoluted', wells, source_ps,dest_ps, deconvolutedPlateQuadrantWells);
  }
  return deconvolutedPlateQuadrantWells;
};

//// Well Selection Parsing Utilities

/**
 * Parse labeled input specified in the Well Selection mini-language:
 * - One named range per line, if the label is omitted,
 * then a blank label is created:
 *  <well selections>="<label>"
 * - If a label is repeated, then wells are concatenated
 * - Wells may not be repeated between labels
 */
var parseNamedWellRanges = Iccbl.parseNamedWellRanges =
  function(rawData, plateSize, errors) {

  if (Iccbl.appModel.DEBUG){
    console.log('parseNamedWellRanges', rawData, plateSize);
  }
  var duplicate_wells_error_msg = 'duplicate wells found in ranges: ';
  var namedWellRanges = {};

  var ordinal = 1;
  if (! rawData ){
    return namedWellRanges;
  }else{
    rawData = rawData.trim();
  }

  _.each(rawData.split(/\n/), function(range){

    range = range.trim();
    if (_.isEmpty(range)) return;

    if (Iccbl.appModel.DEBUG) console.log('parse range', range);

    var rangeToLabel = range.split(/[=]+/);
    var label = '';
    var unparsed = range;
    if (rangeToLabel.length == 2){
      label = rangeToLabel[1].replace(/["']+/g,'');
      unparsed = rangeToLabel[0].replace(/["']+/g,'');
    }
    else if (rangeToLabel.length == 1){
      // pass
    } else {
      errors.push('range to label inputs may on have one equal sign per line: ' + range );
      return;
    }

    if (!_.has(namedWellRanges, label)){
      var namedWellRange = {
        label: label,
        text: unparsed,
        wells: [],
        ordinal: ordinal
      };
      ordinal += 1;
      namedWellRanges[label] = namedWellRange;
    } else {
      namedWellRange = namedWellRanges[label];
    }
    var parsedWells = Iccbl.parseWellSelections(unparsed, plateSize, errors);
    if (Iccbl.appModel.DEBUG) console.log('parsedWells', label, parsedWells);
    namedWellRange['wells'] = namedWellRange['wells'].concat(parsedWells);
  });

  var duplicates =
    Iccbl.find_duplicates(_.map(_.values(namedWellRanges),
      function(nwr){
        return nwr['wells'];
      }
    ));

  if (!_.isEmpty(duplicates)){
    errors.push(duplicate_wells_error_msg + duplicates.join(', '));
  }
  if (Iccbl.appModel.DEBUG) console.log('found named well ranges', namedWellRanges);
  return namedWellRanges;
};

var find_duplicates = Iccbl.find_duplicates = function(arrays){
  if (Iccbl.appModel.DEBUG) console.log('find_duplicates in arrays', arrays)
  var duplicates = [];
  for(var i=0;i<arrays.length;i++){
    var test_array = arrays[i];
    if (!_.isArray(test_array)){
      throw 'find_duplicates requires an array of arrays';
    }
    for (var j=0; j< arrays.length; j++){
      if (j==i) continue;
      var array = arrays[j];
      var d1 = _.intersection(test_array,array);
      duplicates = duplicates.concat(d1);
    }
  }
  duplicates = _.unique(duplicates);
  if (Iccbl.appModel.DEBUG) console.log('duplicates found', duplicates);
  return duplicates;
};


/**
 * Parse input specified in the Well Selection mini-language:
 * where <well selections> are comma separated well-block specifiers:
 * - single well names,
 * - blocks of wells, defined by:
 *  <upper right well name> - <lower left well name>,
 * - single columns, specified by the column number,
 * - single rows, specified by the row letter,
 * - column or row blocks, specified by
 *  <left column> - <right column>
 *  <top row> - <bottom row>
 *
 **/
var parseWellSelections = Iccbl.parseWellSelections =
  function(rawData, plateSize, errors){

  if (Iccbl.appModel.DEBUG) console.log('parseWellSelections: ', rawData, plateSize);

  var wells = [];
  rawData = rawData.trim();
  if (_.isEmpty(rawData)){
    return wells;
  }

  var disallowedMatch = /[^\s\-"',a-zA-Z0-9]+/g;
  var disallowed = disallowedMatch.exec(rawData);
  if (disallowed){
    errors.push('Disallowed chars found: "' + disallowed + '"');
    return;
  }

  var inputs = rawData.split(/\s*,\s*/);

  var numCols = Iccbl.getCols(plateSize);
  var numRows = Iccbl.getRows(plateSize);

  var WELL_PATTERN = this.WELL_PATTERN;
  var rangePartsUnequal = 'Both values of the range must be the same type';
  _.each(inputs, function(input){
    if (_.isEmpty(input)) return;
    if (Iccbl.appModel.DEBUG) console.log('input', input);
    var range = input.split(/\s*-\s*/);
    if (range.length == 2) {
      if (Iccbl.appModel.DEBUG) console.log('range:', range);
      if (ROW_PATTERN.exec(range[0])){
        if (Iccbl.appModel.DEBUG) console.log('row: ', range[0]);
        if (!ROW_PATTERN.exec(range[1])){
          errors.push(rangePartsUnequal + ': ' + input);
          return;
        }
        var startRow = Iccbl.letterToRow(ROW_PATTERN.exec(range[0])[2]);
        var stopRow = Iccbl.letterToRow(ROW_PATTERN.exec(range[1])[2]);
        if(startRow>stopRow) {
          var tempVal=startRow;
          startRow=stopRow; stopRow=tempVal;
        }
        if (stopRow >= numRows){
          errors.push('Row is out of range: "' + input + '", max: '+ rowToLetter(numRows-1));
          return;
        }
        for(var i=0;i<numCols;i++) {
          for(var j=startRow; j<=stopRow; j++)
          {
            wells.push(Iccbl.getWellName(j,i));
          }
        }
      }
      else if (COL_PATTERN.exec(range[0])){
        if (Iccbl.appModel.DEBUG) console.log('col: ', range[0]);
        if (!COL_PATTERN.exec(range[1])){
          errors.push(rangePartsUnequal + ': ' + input);
          return;
        }
        var startCol = parseInt(COL_PATTERN.exec(range[0])[2])-1;
        var stopCol = parseInt(COL_PATTERN.exec(range[1])[2])-1;
        if(startCol>stopCol) {
          var tempVal = startCol; startCol=stopCol; stopCol=tempVal;
        }
        if (stopCol >= numCols){
          errors.push('Col is out of range: "' + input + '", max: '+ numCols);
          return;
        }
        for(var i=startCol; i<=stopCol; i++) {
          for(var j=0; j<numRows; j++) {
            wells.push(Iccbl.getWellName(j,i));
          }
        }
      }
      else if (WELL_PATTERN.exec(range[0])){
        if (!WELL_PATTERN.exec(range[1])){
          errors.push(rangePartsUnequal + ': ' + input);
          return;
        }
        if (Iccbl.appModel.DEBUG) console.log('well: ', range[0]);
        var one = WELL_PATTERN.exec(range[0]);
        var two = WELL_PATTERN.exec(range[1]);
        if (Iccbl.appModel.DEBUG) console.log('one/two', one, two);
        var startRow = Iccbl.letterToRow(one[1]);
        var stopRow = Iccbl.letterToRow(two[1]);
        if (startRow>stopRow) {
          var tempVal=startRow; startRow=stopRow; stopRow=tempVal;
        }
        var startCol = parseInt(one[2])-1;
        var stopCol = parseInt(two[2])-1;

        if(startCol>stopCol) {
          var tempVal = startCol; startCol=stopCol; stopCol=tempVal;
        }
        if (stopCol >= numCols){
          errors.push('Col is out of range: "' + input + '", max: '+ numCols);
          return;
        }
        if (stopRow >= numRows){
          errors.push('Row is out of range: "' + input + '", max: '+ rowToLetter(numRows-1));
          return;
        }
        if (Iccbl.appModel.DEBUG) console.log('start stop row/col: ', startRow,stopRow,startCol,stopCol);
        for(var i=startCol; i<=stopCol; i++) {
          for(var j=startRow; j<=stopRow; j++) {
            wells.push(Iccbl.getWellName(j,i));
          }
        }
      }else{
        errors.push('unrecognized entry: ' + input);
      }
    }else if (range.length == 1) {
      if (ROW_PATTERN.exec(range[0])){
        var row = Iccbl.letterToRow(ROW_PATTERN.exec(range[0])[2]);
        if (row >= numRows){
          errors.push('Row is out of range: "' + input + '", max: '+ rowToLetter(numRows-1));
          return;
        }
        for(var i=0;i<numCols;i++) {
          wells.push(Iccbl.getWellName(row,i));
        }
      }
      else if (COL_PATTERN.exec(range[0])){
        var col = parseInt(COL_PATTERN.exec(range[0])[2])-1;
        if (col  >= numCols){
          errors.push('Col is out of range: "' + input + '", max: '+ numCols);
          return;
        }
        for(var j=0; j<numRows; j++) {
          wells.push(Iccbl.getWellName(j,col));
        }
      }
      else if (WELL_PATTERN.exec(range[0])){
        var pattern = WELL_PATTERN.exec(range[0]);
        var row = Iccbl.letterToRow(pattern[1]);
        var col = parseInt(pattern[2])-1;
        if (col  >= numCols){
          errors.push('Col is out of range: "' + input + '", max: '+ numCols);
          return;
        }
        if (row >= numRows){
          errors.push('Row is out of range: "' + input + '", max: '+ rowToLetter(numRows-1));
          return;
        }
        wells.push(Iccbl.getWellName(row,col))
      }else{
        errors.push('unrecognized entry: ' + input);
      }
    }
  });
  if (Iccbl.appModel.DEBUG) console.log('wells', wells);
  if (Iccbl.appModel.DEBUG && !_.isEmpty(errors)){
    console.log('errors', errors);
  }
  return wells;
};

/**
 * Output selected named ranges of wells into the Well Selection mini-language:
 * - One named range per line, if the label is blank, then it is omitted:
 *  <well selections>="<label>"
 * where <well selections> are comma separated well-block specifiers:
 * - single well names,
 * - blocks of wells, defined by:
 *  <upper right well name> - <lower left well name>,
 * - single columns, specified by the column number,
 * - single rows, specified by the row letter,
 * - column or row blocks, specified by
 *  <left column> - <right column>
 *  <top row> - <bottom row>
 *
 **/
var generateNamedWellBlockString = Iccbl.generateNamedWellBlockString =
  function(namedWellRanges, plateSize) {

  if (Iccbl.appModel.DEBUG) console.log('generateNamedWellBlockString', namedWellRanges);
  var self = this;
  var finalArray = [];
  var nCols = self.getCols(plateSize);
  var nRows = self.getRows(plateSize);
  
  function sameRow(firstEntry, lastEntry){
    var rowLetter1 = WELL_PATTERN.exec(firstEntry)[1];
    var rowLetter2 = WELL_PATTERN.exec(lastEntry)[1];
    return rowLetter1==rowLetter2;
  };
  function sameCol(firstEntry, lastEntry){
    var col1 = WELL_PATTERN.exec(firstEntry)[2];
    var col2 = WELL_PATTERN.exec(lastEntry)[2];
    return col1==col2;
  };
  
  _.each(namedWellRanges, function(namedRange){
    var wellBlocks = self.getWellBlocks(namedRange['wells'], plateSize);
    var label = namedRange['label'];
    if (!_.isEmpty(wellBlocks)){
      var entries = [];
      _.each(wellBlocks, function(wellBlock){
        var entry;
        var firstEntry = wellBlock[0][0];
        if (wellBlock.length > 1){
          var firstBlockLast = wellBlock[0][wellBlock.length-1]
          var lastBlock = wellBlock[wellBlock.length-1];
          var lastEntry = lastBlock[lastBlock.length-1];
          if (Iccbl.appModel.DEBUG) console.log('wellBlock 0', wellBlock[0],wellBlock[0].length, nCols );
          if (wellBlock[0].length == nRows && sameCol(firstEntry,firstBlockLast)){
            // assume a col
            var firstCol = parseInt(WELL_PATTERN.exec(firstEntry)[2]);
            var lastCol = parseInt(WELL_PATTERN.exec(lastEntry)[2]);
            entry = firstCol + '-' + lastCol;
          }else if (wellBlock[0].length == nCols && sameRow(firstEntry,firstBlockLast)){
            // assume a row
            var rowLetter1 = WELL_PATTERN.exec(firstEntry)[1];
            var rowLetter2 = WELL_PATTERN.exec(lastEntry)[1];
            entry = rowLetter1 + '-' + rowLetter2;
          } else {
            entry = firstEntry + '-' + lastEntry;
          }
        }else{
          var onlyBlock = wellBlock[0];
          var firstEntry = onlyBlock[0];
          if (onlyBlock.length > 1){
            var lastEntry = onlyBlock[onlyBlock.length-1];
            if (wellBlock[0].length == nRows && sameCol(firstEntry,lastEntry)){
              // assume a col
              entry = parseInt(WELL_PATTERN.exec(firstEntry)[2]);
            }
            else if (wellBlock[0].length == nCols && sameRow(firstEntry,lastEntry)){
              // assume a row
              entry = WELL_PATTERN.exec(firstEntry)[1];
            }else{
              entry = firstEntry + '-' + lastEntry;
            }
          } else {
            entry = firstEntry;
          }
        }
        entries.push(entry);
      });
      if (!_.isEmpty(label)){
        finalArray.push(entries.join(',') + '="' + label + '"' );
      }else{
        finalArray.push(entries.join(','));
      }
    }
  });
  if (Iccbl.appModel.DEBUG) console.log('finalArray', finalArray);
  return finalArray.join('\n');
};


/**
 * Group a list of well names into contiguous blocks of wells:
 * Process:
 * - starting with a sorted (by row,col) list
 * - first, divide the list into sublists of adjacent wells;
 * either adjacent rows in a column or adjacent columns in a row
 * (which ever yields the largest sublist for the start well)
 * - second combine adjacent row or column sublists into larger well blocks
 * consisting of the sublists.
 * - single wells are separated into well blocks consisting of one well.
 * - Block shape may not be optimal, and is determined by the order of
 * operations (first scanning for adjacent rows, then columns)
 **/
var getWellBlocks = Iccbl.getWellBlocks = function(wells, plateSize){
  var self = this;
  var nCols = self.getCols(plateSize);
  var nRows = self.getRows(plateSize);
  wells.sort();
  var colBlocks = [];

  function findColBlock(wellName, allWells){
    var colBlock;
    var row_col = Iccbl.getWellRowCol(wellName);
    if (Iccbl.appModel.DEBUG) console.log('findColBlock: wellName', wellName, row_col);
    var row = row_col[0];
    var col = row_col[1];
    // first scan down cols
    var blockByCol = [wellName];
    var allWellsCopy = _.without(allWells, wellName);
    for(var currentRow=row+1; currentRow<nRows; currentRow++){
      var testWell = Iccbl.getWellName(currentRow,col);
      if (_.contains(allWellsCopy,testWell)){
        blockByCol.push(testWell);
        allWells = _.without(allWellsCopy, testWell);
      } else {
        break;
      }
    }
    // second scan across rows
    var blockByRow = [wellName];
    var allWellsCopy = _.without(allWells, wellName);
    for(var currentCol=col+1; currentCol<nCols; currentCol++){
      var testWell = Iccbl.getWellName(row,currentCol);
      if (_.contains(allWells,testWell)){
        blockByRow.push(testWell);
        allWells = _.without(allWells, testWell);
      } else {
        break;
      }
    }
    // choose whichever gives biggest block, col blocks first
    if (Iccbl.appModel.DEBUG) console.log('choose biggest block:', blockByCol, blockByRow);
    if (blockByCol.length >= blockByRow.length){
      colBlock = blockByCol;
    }else{
      colBlock = blockByRow;
    }

    colBlock.sort();
    return colBlock;
  }

  function findColBlocks(remainingWells){
    if(!_.isEmpty(remainingWells)){
      var seedWell = remainingWells.shift();
      var colBlock = findColBlock(seedWell, remainingWells);
      colBlocks.push(colBlock);
      remainingWells = _.difference(remainingWells, colBlock);
      findColBlocks(remainingWells);
    }
  };
  findColBlocks(wells);
  if (Iccbl.appModel.DEBUG) console.log('colBlocks', colBlocks);

  function findWellBlock(colBlock, colBlocks){
    if (Iccbl.appModel.DEBUG) console.log('findWellBlock', colBlock,colBlocks)
    var wellBlock = [colBlock];
    var test_start = Iccbl.getWellRowCol(colBlock[0]);
    var test_stop = Iccbl.getWellRowCol(colBlock[colBlock.length-1]);
    _.each(colBlocks, function(currentBlock){
      var row_col_start = Iccbl.getWellRowCol(currentBlock[0]);
      var row_col_stop = Iccbl.getWellRowCol(currentBlock[currentBlock.length-1]);
      if (test_start[1]+1== row_col_start[1]){
        // cols adjacent
        if (test_start[0] == row_col_start[0]
          && test_stop[0] == row_col_stop[0]){
          if (Iccbl.appModel.DEBUG) console.log('found adjacent col', colBlock, currentBlock);
          test_start = row_col_start;
          wellBlock.push(currentBlock);
        }
      }
      else if (test_start[0]+1 == row_col_start[0]){
        // rows adjacent
        if (test_start[1] == row_col_start[1]
          && test_stop[1] == row_col_stop[1]){
          if (Iccbl.appModel.DEBUG) console.log('found adjacent row', colBlock, currentBlock);
          test_start = row_col_start;
          wellBlock.push(currentBlock);
        }
      }
    });
    if (Iccbl.appModel.DEBUG) console.log('findWellBlock finds', wellBlock);
    return wellBlock;
  };
  var wellBlocks = [];
  function findWellBlocks(remainingColBlocks){
    if(!_.isEmpty(remainingColBlocks)){
      var seedBlock = remainingColBlocks.shift();
      var blocks = findWellBlock(seedBlock, remainingColBlocks);
      _.each(blocks, function(block){
        if (_.contains(remainingColBlocks, block)){
          remainingColBlocks = _.without(remainingColBlocks,block);
        }
      });
      wellBlocks.push(blocks);
      findWellBlocks(remainingColBlocks);
    }
  };
  findWellBlocks(colBlocks);

  if (Iccbl.appModel.DEBUG) console.log('final getWellBlocks', wellBlocks);
  return wellBlocks;
};

var parseCompoundVendorIDSearch = Iccbl.parseCompoundVendorIDSearch = function(rawData,errors){
  var search_array = []
  var or_list = rawData.split(SEARCH_LINE_SPLITTING_PATTERN);

  _.each(or_list, function(clause){
    clause = clause.trim();
    if(clause=='') return;
    search_array.push(clause);
  });
  return search_array;
};

/**
 * Parse a Well search by line into an arrary of search lines of the form:
 * input:
 * - lines separated by a newline char
 * - space or comma separated values,
 * output:
 * search_line: {
      plates: [],
      plate_ranges: [],
      wellnames: [],
      errors: []
    }
    - errors are pushed into the passed in errors array
 */
var parseRawWellSearch = Iccbl.parseRawWellSearch = function(rawData,errors){

  if (Iccbl.appModel.DEBUG){
    console.log('parseRawWellSearch', rawData);
  }
  var search_array = []
  rawData = decodeURIComponent(rawData);
  var or_list = rawData.split(SEARCH_LINE_SPLITTING_PATTERN);

  _.each(or_list, function(clause){
    clause = clause.trim();
    if(clause=='') return;
    search_array.push(clause);
  });

  if (Iccbl.appModel.DEBUG){
    console.log('search_array', search_array);
  }
  var final_search_array = [];
  _.each(search_array, function(line){
    var parts = line.split(/[\s,]+/);
    if(!_.isEmpty(parts)){
      var final_search_line = {
        plates: [],
        plate_ranges: [],
        wellnames: [],
        well_ids: [],
        errors: [],
        combined: []
      };
      _.each(parts, function(part){
        if (Iccbl.appModel.DEBUG){
          console.log('test part: '+ part);
        }
        if (PLATE_PATTERN.test(part)){
          if (Iccbl.appModel.DEBUG){
            console.log('found plate:' + part);
          }
          final_search_line.plates.push(part);
        }else if (PLATE_RANGE_PATTERN.test(part)){
          var rangeParts = PLATE_RANGE_PATTERN.exec(part);
          rangeParts = [rangeParts[1],rangeParts[2]];
          rangeParts.sort();
          if (Iccbl.appModel.DEBUG){
            console.log('from PLATE_RANGE_PATTERN:' + part
              + 'to' + rangeParts.join(','));
          }
          final_search_line.plate_ranges.push(rangeParts[0]+'-'+rangeParts[1]);
        }else if (WELL_ID_PATTERN.test(part)){
          var match = WELL_ID_PATTERN.exec(part);
          var plate = parseInt(match[1]);
          var wellrow = match[3].toUpperCase();
          var wellcol = parseInt(match[4]);
          if (wellcol < 10) {
            wellcol = '0'+wellcol;
          }
          var wellname = wellrow + wellcol;
          var wellid = '' + plate + ':' + wellname;
          if (Iccbl.appModel.DEBUG){
            console.log('from WELL_ID:' + part + 'to' + wellid);
          }
          final_search_line['well_ids'].push(wellid);
        }else if (WELL_PATTERN.test(part)) {
          var match = WELL_PATTERN.exec(part);
          var wellrow = match[1].toUpperCase();
          var wellcol = parseInt(match[2]);
          if (wellcol < 10) {
            wellcol = '0'+wellcol;
          }
          var wellname = wellrow + wellcol;
          if (Iccbl.appModel.DEBUG){
            console.log('from WELL_PATTERN:' + part + 'to:' + wellname);
          }
          final_search_line['wellnames'].push(wellname);

        } else {
          final_search_line['errors'].push('part not recognized: ' + part);
          errors.push('part not recognized: ' + part);
        }
      });

      if (Iccbl.appModel.DEBUG){
        console.log('step 1: search_line' + JSON.stringify(final_search_line));
      }

      var well_ids = final_search_line['well_ids'];
      var wellnames = final_search_line['wellnames'];
      var plates = final_search_line['plates'];
      var plate_ranges = final_search_line['plate_ranges'];

      if (_.isEmpty(well_ids) && _.isEmpty(plates) && _.isEmpty(plate_ranges)){
          var errmsg = 'Must specify either a plate, plate range, or well_id: ' + line;
          final_search_line['errors'].push(errmsg);
          errors.push(errmsg);
      }
      if (!_.isEmpty(well_ids)){
        if (!_.isEmpty(plates) || !_.isEmpty(plate_ranges)){
          var errmsg = 'Well ids may not be defined on the same line with '
            + 'plate or plate ranges: ' + line;
          final_search_line['errors'].push(errmsg);
          errors.push(errmsg);
        }
      }

      // Match wellnames only if plate, plate range, or single well_id is identified
      if (!_.isEmpty(wellnames) && _.isEmpty(plates) && _.isEmpty(plate_ranges)){
        if (well_ids.length > 1){
          var errmsg = 'Well names may not be defined with multiple '
            + 'well_ids: ' + line;
          final_search_line['errors'].push(errmsg);
          errors.push(errmsg);
        } else if (well_ids.length == 1){
          var well_id = well_ids[0];
          var match = WELL_ID_PATTERN.exec(well_id);
          var plate = parseInt(match[1]);
          var wellrow = match[3].toUpperCase();
          var wellcol = parseInt(match[4]);
          if (wellcol < 10) {
            wellcol = '0'+wellcol;
          }
          var wellname = wellrow + wellcol;
          final_search_line['wellnames'].push(wellname);
          final_search_line['plates'].push(plate);
          final_search_line['well_ids'] = [];
        } else {
          var errmsg = 'Must specify a plate, plate_range, or well_id '
            + 'for wellnames: ' + line;
          final_search_line['errors'].push(errmsg);
          errors.push(errmsg);
        }
      }
      final_search_line.combined = _.union(
        final_search_line.plates, final_search_line.plate_ranges,
        final_search_line.wellnames, final_search_line.well_ids
      );
      if (Iccbl.appModel.DEBUG){
        console.log('final_search_line.combined ',
          JSON.stringify(final_search_line.combined));
      }
      final_search_array.push(final_search_line);
    }
  });
  if (Iccbl.appModel.DEBUG){
    console.log('final_search_array', final_search_array);
  }
  return final_search_array;

};

var parseRawCopyWellSearch = Iccbl.parseRawCopyWellSearch = function(rawData,errors){

  if (Iccbl.appModel.DEBUG){
    console.log('parseRawCopyWellSearch', rawData);
  }
  var or_list = rawData.split(SEARCH_LINE_SPLITTING_PATTERN);
  var search_array = []
  var final_search_array = [];

  _.each(or_list, function(clause){
    clause = clause.trim();
    if(clause=='') return;

    // split quoted strings, split on spaces or commas
    var parts = _.filter(_.map(
      clause.match(PLATE_COPY_RANGE_SPLITTING_PATTERN),
      function(val){
        return val;
        // 20180313 - do not remove quotes on client; API parser will remove
        //        // unquote
        //        return val.replace(/["']+/g,'');
      }),
      function(val){
        val = val.trim();
        return !_.isEmpty(val);
      });
    search_array.push(parts);
  });

  if (Iccbl.appModel.DEBUG) console.log('parseRawCopyWellSearch: search_array', search_array);
  
  _.each(search_array, function(parts){
    if(!_.isEmpty(parts)){
      var final_search_line = {
        plates: [],
        plate_ranges: [],
        wellnames: [],
        well_ids: [],
        copies: [],
        errors: [],
        combined: []
      };
      _.each(parts, function(part){
        if (Iccbl.appModel.DEBUG){
          console.log('test part: '+ part);
        }
        if (PLATE_PATTERN.test(part)){
          if (Iccbl.appModel.DEBUG){
            console.log('found plate:' + part);
          }
          final_search_line.plates.push(part);
        }else if (PLATE_RANGE_PATTERN.test(part)){
          var rangeParts = PLATE_RANGE_PATTERN.exec(part);
          rangeParts = [rangeParts[1],rangeParts[2]];
          rangeParts.sort();
          if (Iccbl.appModel.DEBUG){
            console.log('from PLATE_RANGE_PATTERN:' + part
              + 'to' + rangeParts.join(','));
          }
          final_search_line.plate_ranges.push(rangeParts[0]+'-'+rangeParts[1]);
        }else if (WELL_ID_PATTERN.test(part)){
          var match = WELL_ID_PATTERN.exec(part);
          var plate = parseInt(match[1]);
          var wellrow = match[3].toUpperCase();
          var wellcol = parseInt(match[4]);
          if (wellcol < 10) {
            wellcol = '0'+wellcol;
          }
          var wellname = wellrow + wellcol;
          var wellid = '' + plate + ':' + wellname;
          if (Iccbl.appModel.DEBUG){
            console.log('from WELL_ID:' + part + 'to' + wellid);
          }
          final_search_line['well_ids'].push(wellid);
        }else if (WELL_PATTERN.test(part)) {
          var match = WELL_PATTERN.exec(part);
          var wellrow = match[1].toUpperCase();
          var wellcol = parseInt(match[2]);
          if (wellcol < 10) {
            wellcol = '0'+wellcol;
          }
          var wellname = wellrow + wellcol;
          if (Iccbl.appModel.DEBUG){
            console.log('from WELL_PATTERN:' + part + 'to:' + wellname);
          }
          final_search_line['wellnames'].push(wellname);
        } else if (COPY_NAME_PATTERN.test(part)) {
          if (Iccbl.appModel.DEBUG){
            console.log('found copy:' + part);
          }
          final_search_line.copies.push(part);
        } else {
          final_search_line['errors'].push('part not recognized: ' + part);
          errors.push('part not recognized: ' + part);
        }
      });

      if (Iccbl.appModel.DEBUG){
        console.log('step 1: search_line' + JSON.stringify(final_search_line));
      }

      var well_ids = final_search_line['well_ids'];
      var wellnames = final_search_line['wellnames'];
      var plates = final_search_line['plates'];
      var plate_ranges = final_search_line['plate_ranges'];
      var copies = final_search_line['copies'];
      
      if (_.isEmpty(well_ids) && _.isEmpty(plates) && _.isEmpty(plate_ranges)
          && _.isEmpty(copies)){
          var errmsg = 'Must specify either a plate, plate range, copy, or well_id: ' + parts.join(', ');
          final_search_line['errors'].push(errmsg);
          errors.push(errmsg);
      }
      if (_.isEmpty(well_ids) && _.isEmpty(plates) && _.isEmpty(plate_ranges)
          && !_.isEmpty(copies)){
          var errmsg = 'Must specify either a plate, plate range, or well_id with copies: ' + parts.join(', ');
          final_search_line['errors'].push(errmsg);
          errors.push(errmsg);
      }
      if (!_.isEmpty(well_ids)){
        if (!_.isEmpty(plates) || !_.isEmpty(plate_ranges)){
          var errmsg = 'Well ids may not be defined on the same line with '
            + 'plate or plate ranges: ' + parts.join(', ');;
          final_search_line['errors'].push(errmsg);
          errors.push(errmsg);
        }
      }

      // Match wellnames only if plate, plate range, or single well_id is identified
      if (!_.isEmpty(wellnames) && _.isEmpty(plates) && _.isEmpty(plate_ranges)){
        if (well_ids.length > 1){
          var errmsg = 'Well names may not be defined with multiple '
            + 'well_ids: ' + parts.join(', ');;
          final_search_line['errors'].push(errmsg);
          errors.push(errmsg);
        } else if (well_ids.length == 1){
          var well_id = well_ids[0];
          var match = WELL_ID_PATTERN.exec(well_id);
          var plate = parseInt(match[1]);
          var wellrow = match[3].toUpperCase();
          var wellcol = parseInt(match[4]);
          if (wellcol < 10) {
            wellcol = '0'+wellcol;
          }
          var wellname = wellrow + wellcol;
          final_search_line['wellnames'].push(wellname);
          final_search_line['plates'].push(plate);
          final_search_line['well_ids'] = [];
        } else {
          var errmsg = 'Must specify a plate, plate_range, or well_id '
            + 'for wellnames: ' + parts.join(', ');
          final_search_line['errors'].push(errmsg);
          errors.push(errmsg);
        }
      }
      final_search_line.combined = _.union(
        final_search_line.plates, final_search_line.plate_ranges,
        final_search_line.wellnames, final_search_line.well_ids,
        final_search_line.copies
      );
      if (Iccbl.appModel.DEBUG){
        console.log('final_search_line.combined ',
          JSON.stringify(final_search_line.combined));
      }
      final_search_array.push(final_search_line);
    }
  });
  if (Iccbl.appModel.DEBUG){
    console.log('final_search_array', final_search_array);
  }
  return final_search_array;

};

/**
 * Parse a Copy Plate search by line into an array of search lines of the form:
 * input:
 * - lines separated by a newline char
 * - space or comma separated values,
 * - quoted strings preserved; interpreted as copy names
 * - copy names must begin with a letter, may contain spaces and special chars
 * if quoted
 * - numbers separated by (spaces) and dash interpreted as a plate range
 * output:
 * search_line: {
      plates: [],
      plate_ranges: [],
      copies: [],
      combined: []
    }
    - errors are pushed into the passed in errors array
 */
var parseRawPlateSearch = Iccbl.parseRawPlateSearch = function(rawData, errors){

  var or_list = rawData.split(SEARCH_LINE_SPLITTING_PATTERN);
  var search_array = []
  var final_search_array = [];

  _.each(or_list, function(clause){
    clause = clause.trim();
    if(clause=='') return;

    // split quoted strings, split on spaces or commas
    var parts = _.filter(_.map(
      clause.match(PLATE_COPY_RANGE_SPLITTING_PATTERN),
      function(val){
        return val;
        // 20180313 - do not remove quotes on client; API parser will remove
        //        // unquote
        //        return val.replace(/["']+/g,'');
      }),
      function(val){
        val = val.trim();
        return !_.isEmpty(val);
      });
    search_array.push(parts);
  });

  if (Iccbl.appModel.DEBUG) console.log('parseRawPlateSearch: search_array', search_array);

  _.each(search_array, function(parts){
    if(!_.isEmpty(parts)){
      var final_search_line = {
        combined: [],
        plates: [],
        plate_ranges: [],
        copies: []
      };
      
      // FIXME: support for commas in the line:
      // If parts consist of copy, or plate, or plate_range, use AND
      // If parts consist of copyplate specifiers, use OR
      //var parts = line.split(/[\s,]+/);
      
      
      _.each(parts, function(part){
        if (PLATE_PATTERN.test(part)){
          final_search_line.plates.push(part);
        }else if (PLATE_RANGE_PATTERN.test(part)){
          var rangeParts = PLATE_RANGE_PATTERN.exec(part);
          final_search_line.plate_ranges.push(rangeParts[1]+'-'+rangeParts[2]);
        }else if (COPY_NAME_PATTERN.test(part)){
          final_search_line.copies.push(part);
//        } else if (COPY_PLATE_RANGE_KEY_PATTERN.test(part)){
//          //TODO 20181114 - NOT TESTED
//          var rangeParts = COPY_PLATE_RANGE_KEY_PATTERN.exec(part);
//          final_search_line.copies.push(rangeParts[4]); // todo test
//          var platePart = rangeParts[5];
//          if (PLATE_RANGE_PATTERN.test(platePart)){
//            var rangeParts = PLATE_RANGE_PATTERN.exec(platePart);
//            final_search_line.plate_ranges.push(rangeParts[1]+'-'+rangeParts[2]);
//          } else {
//            final_search_line.plates.push(platePart);
//          }
        } else {
          errors.push(
            'Copy names must begin with a letter, and may only contain '
            + 'letters, numbers, spaces, dashes and colons');
        }
      });
      final_search_line.combined = _.union(
        final_search_line.plates, final_search_line.plate_ranges,
        final_search_line.copies
      );

      final_search_array.push(final_search_line);
    }
  });
  return final_search_array;
};

var parseRawPlateSearchToArray = Iccbl.parseRawPlateSearchToArray = function(rawData, errors){
  var plateSearchTextArray = [];

  var plateData = Iccbl.parseRawPlateSearch(rawData, errors);
  _.each(plateData, function(plateClause){
    plateSearchTextArray = plateSearchTextArray.concat(
      plateClause.plates, plateClause.plate_ranges);
    _.each(plateClause.copies,function(copy){
      if (copy.match(/[ \,\-\:]/)){
        copy = '"' + copy + '"';
      }
      plateSearchTextArray.push(copy);
    });
  });
  return plateSearchTextArray;
};

/**
 * TODO: refactor this into the SIUnitsFormatter
 */
var parseSIVolume = Iccbl.parseSIVolume = function(rawText){
  var volErrMsg = 'Volume not parsed, must be of the form: ' +
    '"[number][uL|nL]"';
  var volMatch = SIUnitsFormatter.prototype.SI_UNIT_PATTERN.exec(rawText);
  if (!volMatch){
    throw volErrMsg;
  }
  if (Iccbl.appModel.DEBUG) console.log('parse volMatch', volMatch);
  var volume = parseFloat(volMatch[1]);
  // Allow for a maximum of 3 digits
  volume = volume.toPrecision(3);
  var multiplier = 1e-6;
  if (volMatch.length == 4){
    if (volMatch[3].toLowerCase() == 'n'){
      multiplier = 1e-9;
    } else {
      multiplier = 1e-6;
    }
  }
  volume *= multiplier;
  volume = volume.toPrecision(3);
  return volume;
}

/**
 * Parse a screening inquiry of the form:
 * ignored text ...(#screen_facility_id) (plate ranges) (volume) (replicates),
 * e.g.
 * Screener Name (1292) 3560-3567, 1795-1811 100 nL x 2
 *
 * @ return
 * {
 *    screen_facility_id, volume_required, plate_ranges, replicate_count }
 */
var parseRawScreeningInquiry = Iccbl.parseRawScreeningInquiry = function(rawText, errors) {

  var screenPattern = /\(\s*(\w+)\s*\)/;
  var volumePattern = /\s+([\d\.]+\s*[un]L)\s+x\s*\d+\s*$/i;
  var replicatePattern = /[un]L\s+x\s*(\d+)/i;
  var generalErrMsg = 'Screening inquiry format: ' +
    '"(screen id) plate-ranges volume replicates"';
  var screenErrMsg = 'Screen Facility ID not parsed - must be of the form: ' +
    '"(screen_facility_id)" with parenthesis';
  var volErrMsg = 'Volume not parsed, must be of the form: ' +
    '"[number][uL|nL]"';
  var replicateErrMsg = 'Screening replicates not parsed, must be of the form: ' +
    '"X [number]"';
  var screenMatch = screenPattern.exec(rawText);
  if (!screenMatch){
    errors.push(screenErrMsg);
  }
  var volMatch = volumePattern.exec(rawText);
  if (!volMatch){
    var detailMessage = 'vol match fails for pattern: "' + volumePattern.source + '" ' +
      'for the text: "' + rawText + '"';
    if (Iccbl.appModel.DEBUG) console.log(detailMessage);
    errors.push(volErrMsg);
    if (Iccbl.appModel.DEBUG){
      errors.push(detailMessage);
    };
  }
  var replicateMatch = replicatePattern.exec(rawText);
  if (!replicateMatch) {
    errors.push(replicateErrMsg);
  }

  if (_.isEmpty(errors)){
    var data = {
      rawText: rawText
    };
    var screenText = screenMatch[0];
    data['screen_facility_id']= screenMatch[1];
    var volume = Iccbl.parseSIVolume(volMatch[1])
    data['volume_required']= volume;
    data['replicate_count'] = replicateMatch[1];

    var startPlatesIndex = rawText.indexOf(screenText) + screenText.length;
    var endPlatesIndex = rawText.indexOf(volMatch[0]);
    var plateText = rawText.slice(startPlatesIndex,endPlatesIndex);
    data['plate_ranges'] = Iccbl.parseRawPlateSearch(plateText, errors);

    if (_.isEmpty(errors)){
      if (_.isEmpty(data['plate_ranges'])){
        errors.push('No plate ranges found');
      }
    }
    return data;
  }
  return null;
};


/**
 * Decode the screening inquiry values from the URL "search" parameter, encoded using
 * the above described "plate_search_mini_language"
 *
 * @return urlStackData {
 *  plate_search, volume_required, replicate_count, show_retired, show_existing
 * }
 */
var parseScreeningInquiryURLParam
    = Iccbl.parseScreeningInquiryURLParam
    = function(urlData, errors) {

  var urlStackData = {};
  var extra_volumes = [];
  var errors = [];
  var fullPlateSearch = [];

  _.each(urlData.split(';'), function(element){

    if (Iccbl.appModel.DEBUG) console.log('parse element; "' + element + '"');

    if (element == 'show_retired_plates'){
      urlStackData.show_retired_plates = true;
      return;
    }
    if (element == 'show_existing'){
      urlStackData.show_existing = true;
      return;
    }
    // Convert SI unit volume required
    else if (URI_REPLICATE_VOLUME_PATTERN.exec(element)){
      var match = URI_REPLICATE_VOLUME_PATTERN.exec(element);
      var volMatch = match[3];
      if (urlStackData.volume_required){
        extra_volumes.push(volMatch);
      }else{
        urlStackData.volume_required = Iccbl.parseSIVolume(volMatch);
      }
      urlStackData.replicate_count = parseInt(match[2]);
      return;
    }

    var plateSearchTextArray = Iccbl.parseRawPlateSearchToArray(element, errors);
//    var plateData = Iccbl.parseRawPlateSearch(element, errors);
//    _.each(plateData, function(plateClause){
//      plateSearchTextArray = plateSearchTextArray.concat(
//        plateClause.plates, plateClause.plate_ranges);
//      _.each(plateClause.copies,function(copy){
//        if (copy.match(/[ \,\-\:]/)){
//          copy = '"' + copy + '"';
//        }
//        plateSearchTextArray.push(copy);
//      });
//    });
    fullPlateSearch.push(plateSearchTextArray.join(', '));
  });
  urlStackData['plate_search'] = fullPlateSearch;

  if (!_.isEmpty(extra_volumes)){
    errors.push(
      'More than one volume required specified in the URL; ' +
      'Extra specifiers are ignored: ' + extra_volumes.join(', '));
  }
  return urlStackData;
};


/**
 * Return an array of ID keys from the model
 *
 * @param schema a resource definition as defined by the API
 * @param model Backbone.Model or Object described by the schema
 * @return array
 */
var getIdKeys = Iccbl.getIdKeys = function(model,schema) {
  if (! model) return;

  if (_.has(schema, 'id_attribute')) {

    var id_attribute = schema['id_attribute'];
    var idList = [];

    _.each(id_attribute, function(item){
      var keyval;
      if (model instanceof Backbone.Model){
        keyval = model.get(item);
      }else{
        keyval = _.result(model,item);
      }
      if (!_.isUndefined(keyval)){
        idList.push(keyval);
        //throw new TypeError('ID key: ' + item + ', not found on: ' + model);
      }
    });
    return idList;
  } else {
    throw new TypeError("'id_attribute' not found on the schema: "
            + JSON.stringify(schema)
            + ', for the model: ' + JSON.stringify(model.attributes));
  }

};

/**
 * Generate an ID string for the model
 *
 * The "complete ID" is formed by joining the ID keys with the forward slash.
 */
var getIdFromIdAttribute = Iccbl.getIdFromIdAttribute =
  function(model, schema){

    return Iccbl.getIdKeys(model,schema).join('/');
};

/**
 * Pops the appropriate number of items from the URI stack to form a model key.
 *
 * - pop one key, in order, for each of the key fields specified in
 * the resource id_attribute.
 *
 * @param resource - a resource definition as defined by the API
 * @param urlStack -
 *          array representation of the current unprocessed URI elements.
 * @param consumedStack -
 *          holds the items popped off the stack
 */
var popKeyFromStack = Iccbl.popKeyFromStack = function(
    resource, urlStack, consumedStack){

  var id  = '';
  var self = this;
  var checkStack = function(stack){
    if (_.isEmpty(urlStack)){
      var msg = 'not enough items on the URL to create the key for resource: ' +
          resource.title + JSON.stringify(resource.id_attribute);
      throw msg;
    }
  };
  if(resource.key == 'apilog'){
    ref_resource_name = urlStack.shift();
    consumedStack.push(ref_resource_name);
    ref_resource = Iccbl.appModel.getResource(ref_resource_name);
    if(ref_resource && !_.isEmpty(ref_resource)){
      checkStack(urlStack);
      if (urlStack[0] == ref_resource_name){
        // if the key == resource, then this is a "parent log" (patch/post list)
        key = urlStack.shift();
        consumedStack.push(key);
      }else{
        key = self.popKeyFromStack(ref_resource,urlStack,consumedStack);
      }
    }
    checkStack(urlStack);
    date_time = urlStack.shift();
    consumedStack.push(date_time);
    id += [ref_resource_name,key,date_time].join('/');
  }else{
    _.each(resource.id_attribute, function(attribute){
      checkStack(urlStack);
      // don't care what the id is, just pop one for each
      var item = urlStack.shift();
      consumedStack.push(item);
      if ( id !== '' ){
        id += '/' + item;
      }
      else {
        id += item;
      }
    });
  }
  return id;
};

/**
 * Sort an array of keys based on the associated ordinal for each key
 * in the Resource.fields "fieldHash"
 */
var sortOnOrdinal = Iccbl.sortOnOrdinal = function(keys, fieldHash) {
  var sorted = _(keys).sort(function(a, b) {
    if (!_.has(fieldHash, a) || !_.has(fieldHash, b)) {
      if (_.has(fieldHash, b)) {
        return -1;
      } else if (_.has(fieldHash, a)) {
        return 1;
      }
      return 0;
    }
    order_a = fieldHash[a]['ordinal'];
    // TODO: need an edit order by
    order_b = fieldHash[b]['ordinal'];
    if (_.isNumber(order_a) && _.isNumber(order_b)) {
      return order_a - order_b;
    } else if (_.isNumber(order_a)) {
      return -1;
    } else if (_.isNumber(order_b)) {
      return 1;
    } else {
      return 0;
    }
  });
  return sorted;
};

/**
 * Create a title from the schema "title_attribute".
 *
 * Note: the title_attribute is an array of field specifiers and strings.
 * If an array item is a field, the field value will be used,
 * If an array item is not a field, then it will be concatenated directly.
 */
var getTitleFromTitleAttribute = Iccbl.getTitleFromTitleAttribute =
  function(model, schema){
    var re_isQuoted = /['"]+/g;
    var fields = schema['fields'];
    if(_.has(schema, 'title_attribute')){
      var title = _.reduce(
        schema['title_attribute'],
        function(memo, item){
          if(item && item.match(re_isQuoted)){
            memo += item.replace(re_isQuoted, '');
          }else{
            if( model.has(item) ){
              var val = model.get(item);
              if (!_.has(fields,item)){
                throw 'Title property: ' + item + ', not present on model: '+ schema.key ;
              }
              if (!_.isEmpty(fields[item].vocabulary_scope_ref)){
                val = Iccbl.appModel.getVocabularyTitle(
                  fields[item].vocabulary_scope_ref,val);
              }
              memo += val
            }else{
              memo += item
            }
          }
          return memo ;
        }, '');
      return title;
    }else{
      throw new TypeError("'title_attribute' not found on the schema: " +
          JSON.stringify(schema)
          + ', for the model: ' + JSON.stringify(model.attributes));
    }
};


/**
 * Determine if an array of URI fragments contains any match with the given
 * matchString.
 * Useful for determining if a partial URI (the matchstring) matches the URL,
 * parsed as a URL stack array.
 *
 * Matches from the right to left;
 * allowing URI fragments to match their parent URIs.
 * Similar the the contains function, but using item.indexOf(matchString) ||
 * matchString.indexOf(item) for the truth test.
 */
var containsByMatch = Iccbl.containsByMatch = function(array, matchstring){
  return _.find(array, function(item) {
    var result = false;
    var index = matchstring.indexOf(item);
    if (index > -1 && index+item.length == matchstring.length ){
      result = true;
    }
    var index = item.indexOf(matchstring);
    if (!result && index > -1 && index+matchstring.length == item.length){
      result = true;
    }
    return result;
  });
};

/**
 * Break a long label into multiple lines for display.
 *
 * Split label strings on non-word characters and re-join into lines,
 * where each line is less than max_line_length
 * (or, if a part is longer than max_line_length,
 * then that part becomes an entire line).
 */
var createLabel = Iccbl.createLabel =
  function(original_label, max_line_length, break_char){

    var lines = [];
    var labelParts = original_label.split(/([\s_\-\.,]+)/);
    var line = '';
    _.each(labelParts, function(part){
      if(line.length > 0){
        var temp = line + part;
        if(temp.trim().length <= max_line_length){
          line = temp;
        }else{
          line = line.trim();
          if (line.length > 0) {
            lines.push(line);
          }
          line = part;
        }
      }else{
        if( part != ' '){
          line = part;
        }
      }
    });
    line = line.trim();
    lines.push(line);

    if(_.isUndefined(break_char)){
      break_char = '<br>';
    }
    return lines.join(break_char);
};

/**
 * Parse an inline comment array of the form:
 * [ "comment_user$comment_date$comment_text", ...]
 */
var parseComments = Iccbl.parseComments = function(comment_array){
  return _.map(
    comment_array,
    function(comment){
      var comment_parts = comment.split(Iccbl.appModel.LIST_DELIMITER_SUB_ARRAY);
      if (comment_parts.length == 3){
        return '(' + comment_parts[0] + ') ' +
          Iccbl.getDateString(comment_parts[1]) +
          ': ' + comment_parts[2];
      } else {
        if (Iccbl.appModel.DEBUG) console.log('unparsed comment:', comment_parts)
        return comment_parts.join(Iccbl.appModel.LIST_DELIMITER_SUB_ARRAY);
      }
    }).join('\n===== end comment =====\n');
};

/*** Create a collapsible/expandible div for text ***/
var collapsibleText = Iccbl.collapsibleText = function collapsibleText(text, len){
  
  var finalText = "";
  if (!text) return text;
  if (text.length < len){
    // NOTE: convert all text to line-based html, as in generic_detail_stickit
    // (needed because this replaces text from generic_detail_stickit)
    // ( NOTE: another option is to modify white-space as in:
    //   var expandedDiv = $('<div  style="white-space: pre-wrap;" />');
    return text.replace(/(\r\n|\n|\r)/gm,"<br/>");
  } else {
  
    var state = false;
    var container = $('<div id="comments-div" />');
    var collapsedDiv = $('<div/>');
    var expandedDiv = $('<div/>');
    /* ascii code for the ellipsis character */
    var link = $('<a>&nbsp;<strong><u>\u2026</u></strong></a>'); 
  
    // split text on lines
    var totalLen = 0;
    _.find(text.split(/\r\n|\n|\r/g), function(word){
      console.log('word: "' + word + '"');
      if (totalLen + word.length < len){
        if (totalLen > 0) finalText += '\n';
        totalLen += word.length;
        finalText += word;
      }else{
        return true;
      }
    });
    if (_.isEmpty(finalText)){
      // if splitting on lines fails, split text on words
      var finalText = "";
      var totalLen = 0;
      _.find(text.split(/\b/g), function(word){
        if(totalLen + word.length < len){
          totalLen += word.length;
          finalText += word;
        }else{
          return true;
        }
      });
    }
    
    // NOTE: convert all text to line-based html, as in generic_detail_stickit
    collapsedDiv.html(finalText.replace(/(\r\n|\n|\r)/gm,"<br/>"));
    collapsedDiv.append(link);
    expandedDiv.html(text.replace(/(\r\n|\n|\r)/gm,"<br/>"));
    
    container.append(collapsedDiv);
    container.append(expandedDiv);
  
    expandedDiv.toggle(state);
    container.click(function(e){
      e.preventDefault();
      state = !state;
      collapsedDiv.toggle(!state);
      expandedDiv.toggle(state);
    });
    
    return container;
  }
}

/**
 * Create a comment icon with a link to display (parsed) comments in a
 * modal dialog.
 */
var createCommentIcon = Iccbl.createCommentIcon = function(comments, title){
  var comment_icon = $(
    '<span class="glyphicon glyphicon-comment" ' +
    'style="color: lightgray; " ></span>');
  comment_icon.attr('title', comments);

  var rows = 10;
  var buttons_on_top = false;
  if (comments.length > 300){
    rows = 30;
    buttons_on_top = true;
  }
  comment_icon.click(function(e){
    e.preventDefault();
    var body = $('<textarea class="input-full" rows=' + rows + ' ></textarea>');
    body.val(comments);
    Iccbl.appModel.showModalMessage({
      title: title,
      view: body,
      buttons_on_top: buttons_on_top
    });
  });
  return comment_icon;
};

var formatResponseError = Iccbl.formatResponseError = function(response){

  var msg = '';
  var sep = '\n';
  if (!_.isUndefined(response.status))
      msg += response.status;
  if (!_.isUndefined(response.statusText))
      msg += sep + response.statusText;
  if (!_.isEmpty(response.responseText))
      msg += sep + response.responseText;
  return msg;
}

var CollectionOnClient = Iccbl.CollectionOnClient = Backbone.Collection.extend({

  /**
   * Override collection parse method: Parse server response data.
   */
  parse : function(resp) {
    if (_.has(resp,Iccbl.appModel.API_RESULT_DATA)){
      return resp[Iccbl.appModel.API_RESULT_DATA];
    }
    return resp.objects;
  },

  setSearch: function(){
    //nop, for now
  }
});


var getCollectionOnClient = Iccbl.getCollectionOnClient =
  function(url, callback, options, failCallback){

    var options = options || {};
    var data_for_get = options.data_for_get || {};
    data_for_get = _.extend({ limit: 0 },data_for_get);
    var CollectionClass = Iccbl.CollectionOnClient.extend({
      url: url
    });
    var instance = new CollectionClass();
    instance.fetch({
      data: data_for_get,
      success: function(collection, response) {
        callback(collection);
      },
      always: function(){
      }
    }).fail(function(){ 
      if (failCallback) failCallback.apply(this,arguments);
      Iccbl.appModel.jqXHRfail.apply(this,arguments); 
    });
};

var getCollection = Iccbl.getCollection =
  function(schemaResult, url, callback) {
    var CollectionClass = Iccbl.MyCollection.extend({
        url : url,
        defaults : {}
    });
    var instance = new CollectionClass();
    instance.fetch({
        success : function(collection) {
            callback(schemaResult, collection);
        },
        error : function(model, response, options) {
            var msg = 'Error locating resource: ' + url;
            var sep = '\n';
            if (!_.isUndefined(response.status))
                msg += sep + response.status;
            if (!_.isUndefined(response.statusText))
                msg += sep + response.statusText;
            if (!_.isEmpty(response.responseText))
                msg += sep + response.responseText;
            window.alert(msg);
            // TODO: use Bootstrap inscreen alert classed message div
        }
    });
};

var MyModel = Iccbl.MyModel = Backbone.Model.extend({

  url : function() {
    // Add trailing slash for Tastypie
    var url = Backbone.Model.prototype.url.call(this);
    return url + (url.charAt(url.length - 1) === '/' ? '' : '/');
  },

  initialize : function() {
    Backbone.Model.prototype.initialize.apply(this, arguments);
    var self = this;
    this.url = MyModel.prototype.url;
  },
});


///// Backgrid.Cell customizations /////

var BaseCell = Iccbl.BaseCell = Backgrid.Cell.extend({

  initialize: function (options) {

    Backgrid.Cell.prototype.initialize.apply(this, arguments);

    var self = this;
    var initialValue = this.initialValue = this.model.get(this.column.get('name'));
    this.model.on('change:'+this.column.get("name") , function(){
      // Block updates caused by adding columns
      if (!_.isUndefined(self.model.previous(self.column.get("name")))){
        if (self.isEdited()){
          self.$el.addClass('edited');
      } else {
        self.$el.removeClass('edited');
      }
      }
    });
  },

  isEdited: function() {
    if (this.isEditable()){
      var val = this.model.get(this.column.get('name'));
      return val !== this.initialValue;
    }
    return false;
  },

  isEditable: function(){
    var model = this.model, column = this.column;
    return Backgrid.callByNeed(column.editable(), column, model);
  },

});

/**
 * Override BooleanCell:
 * - cellClick toggles the checkbox
 * - "edited" flag is set and initialValue is tracked
 */
var BooleanCell = Iccbl.BooleanCell = Backgrid.BooleanCell.extend({

  initialize: function(){

    BooleanCell.__super__.initialize.apply(this, arguments);
    var self = this;
    var initialValue = this.initialValue = this.model.get(this.column.get('name'));

    this.model.on('change:'+this.column.get("name") , function(){
      if (self.isEdited()){
        self.$el.addClass('edited');
      } else {
        self.$el.removeClass('edited');
      }
    });
  },

  isEditable: function(){
    var model = this.model, column = this.column;
    return Backgrid.callByNeed(column.editable(), column, model);
  },

  isEdited: function() {
    if (this.isEditable()){
      var val = this.model.get(this.column.get('name'));
      if (Iccbl.appModel.DEBUG){
        console.log('isEdited:', this.initialValue, val, val !== this.initialValue);
      }
      return val !== this.initialValue;
    }
    return false;
  },

  // Set up to toggle the checkbox whenever the TD is clicked
  events: {
    'click': 'cellClicked'
  },

  cellClicked: function(e){
    e.stopPropagation();
    if (this.isEditable()){
      var model = this.model, column = this.column;
      var checked = model.get(column.get("name"));
      if (this.isEdited()){
        if (checked){
          model.set(column.get("name"), this.initialValue);
        } else {
          model.set(column.get("name"), !checked);
        }
      } else {
        model.set(column.get("name"), !checked);
      }
    }
  },

  render: function () {
    var model = this.model, column = this.column;
    var val = this.formatter.fromRaw(model.get(column.get("name")), model);
    this.$el.empty();
    if (this.isEditable()){
      this.$el.css('text-align','center');
      this.$el.append($("<input>", {
        tabIndex: -1,
        type: "checkbox",
        checked: this.formatter.fromRaw(model.get(column.get("name")), model)
      }));
      //      this.delegateEvents();
    } else {
      val = (''+val).toLowerCase();
      if (val == 'true' ){
        val = 'True';
      }else if (val == 'false') {
        val = 'False';
      }else if (val == 'null') {
        val = '';
      }
      this.$el.text(val);
    }
    return this;
  }

});

var StringFormatter = Iccbl.StringFormatter = function () {};

StringFormatter.prototype = new Backgrid.StringFormatter();

_.extend(StringFormatter.prototype, {
  /**
   * Extend Backgrid.StringFormatter to add spaces between values in arrays.
   */
  fromRaw: function (rawValue, model) {
    if (_.isUndefined(rawValue) || _.isNull(rawValue)) return '';
    if (_.isArray(rawValue)) {
      return rawValue.join(', ');
    } else {
      return rawValue + '';
    }
  }
});

/**
 * Simple unformatted cell to wrap long strings
 */
var TextWrapCell = Iccbl.TextWrapCell = Backgrid.Cell.extend({
  formatter: Iccbl.StringFormatter,
  className: 'text-wrap-cell',

  /**
   * Override render to use $el.html() instead of $el.text()
   * - the "text()" method escapes string values
   */
  render: function () {
    var $el = this.$el;
    $el.empty();
    var model = this.model;
    var columnName = this.column.get("name");
    $el.html(this.formatter.fromRaw(model.get(columnName), model));
    $el.addClass(columnName);
    this.updateStateClassesMaybe();
    this.delegateEvents();
    return this;
  },

});

/**
 * CommentArrayCell and CommentFormatter:
 * Parse a nested comment array for table view
 */
var CommentFormatter = Iccbl.CommentFormatter = function () {};
CommentFormatter.prototype = new Backgrid.CellFormatter();
_.extend(CommentFormatter.prototype, {
  fromRaw: function (rawValue, model) {
    if (_.isUndefined(rawValue) || _.isNull(rawValue) || _.isEmpty(rawValue)) return '';
    return Iccbl.parseComments(rawValue);
  }
});

var CommentArrayCell = Iccbl.CommentArrayCell = Iccbl.TextWrapCell.extend({
  formatter: CommentFormatter
});

var StringCell = Iccbl.StringCell = Backgrid.StringCell.extend({
  formatter: Iccbl.StringFormatter,
  initialize: function(){
    StringCell.__super__.initialize.apply(this, arguments);
    var self = this;
    this.model.on('change:'+this.column.get("name") , function(){
      // Block updates caused by adding columns
      if (!_.isUndefined(self.model.previous(self.column.get("name")))){
        self.$el.addClass('edited');
      }
    });
  }
});

var LinkCell = Iccbl.LinkCell = Iccbl.BaseCell.extend({

  // TODO: redo the link cell like the UriListCell

  className : "link-cell",

  events : {
    'click A': 'linkCallback',
  },

  /**
   * @property {string} ["string with {model_key} values to interpolate"]
   */
  hrefTemplate: 'Http://',

  /**
   * @property {string} [title] The title attribute of the generated anchor.
   *           It uses the display value formatted by the `formatter.fromRaw`
   *           by default.
   */
  title: null,

  /**
   * @property {string} [target="_self"] The target attribute of the
   *           generated anchor.
   * - _blank: to create a new tab
   * - _self
   */
  target: "_self",

  initialize : function(options) {
    LinkCell.__super__.initialize.apply(this, arguments);
    // console.log('Initialize link cell', this.column.get("name"), this);
  },

  linkCallback: function(e){
    console.log('link clicked, override to handle', e);
  },

  get_href: function(){
    var self = this;
    var columnKey = self.column.get('name');
    // Limit link generation to "allowed" resources for screeners.
    // TODO: (Case 1) Filter based on permission to view the target resource
    // entity. (This will require filtering on server).
    // TODO: (Case 2) Filter based on permission to read from resource; need to 
    // store the link target resource in the metadata.
    
    var restrictedResourceFields = [
      'source_copy_name','library_plate','plate_count','plate_number'
    ];
    var restrictedUserFields = [
          'screensaver_user_id', 'lab_head_id', 'lead_screener_id',
          'serviced_user_id','performed_by_user_id'];
    if (!Iccbl.appModel.hasGroup('readEverythingAdmin')){
      var linkIsFiltered = false;
      var formattedString;
      if (_.contains(restrictedResourceFields, columnKey)){
        linkIsFiltered = true;
      } else {
        function linkPermissionFilter(fieldKey, value){
      
          // Case 1: filter links based on allowed visibility of instance values 
          // (screensaver_user_id must be "viewable"; follows is an arbitrary 
          // list that must be updated as needed).
          if (_.contains(restrictedUserFields, fieldKey)){
            var userOptions = Iccbl.appModel.getUserOptions();
            if (_.find(userOptions, function(useroption){
              return useroption.val == value;
            })){
              return false;
            } else {
              linkIsFiltered = true;
              return true;
            }
          
          // Case 2: filter link based on permission to view resource. (follows 
          // is an arbitrary list of known link field ids for restricted resources).
          }else if (_.contains(restrictedResourceFields, fieldKey)){
              linkIsFiltered = true;
              return true;
          }
        }
        formattedString = Iccbl.formatString(
          self.hrefTemplate,self.model, null, linkPermissionFilter);
      }
      if (linkIsFiltered === true){
        return null;
      } else {
        return formattedString;
      }
    } else {
      return Iccbl.formatString(self.hrefTemplate,self.model);
    }
  },

  render : function() {
    var self = this;
    this.$el.empty();
    var columnKey = this.column.get("name");
    var rawValue = this.model.get(columnKey);
    var formattedValue = this.formatter.fromRaw(rawValue);
    var href = self.get_href();
    
    
    if (href){
      self.$el.append($('<a>', {
        tabIndex : -1,
        href : self.get_href(),
        target : self.target,
        title: self.title
      }).text(formattedValue));
    } else { 
      self.$el.append(formattedValue);
    }
    return this;
  },
});

var DateLinkCell = Iccbl.DateLinkCell = Iccbl.LinkCell.extend({

  render: function() {
    var self = this;
    this.$el.empty();
    var formattedValue = getIccblDateString(
      this.model.get(this.column.get("name")));
    var interpolatedVal = Iccbl.formatString(self.hrefTemplate,self.model);
    self.$el.append($('<a>', {
      tabIndex : -1,
      href : interpolatedVal,
      target : self.target,
      title: self.title
    }).text(formattedValue));
    return this;
  }

});


var UriListCell = Iccbl.UriListCell = Iccbl.BaseCell.extend({

  className : "",

  /**
   * @property {string} ["string with {model_key} values to interpolate"]
   */
  hrefTemplate: 'Http://',

  /**
   * @property {string} [title] The title attribute of the generated anchor. It
   *           uses the display value formatted by the `formatter.fromRaw` by
   *           default.
   */
  title: null,

  /**
   * @property {string} [target="_blank"] The target attribute of the generated
   *           anchor.
   */
  target: "_self",

  initialize : function(options) {
    UriListCell.__super__.initialize.apply(this, arguments);
  },

  render : function() {
    var self = this;
    this.$el.empty();
    var rawValue = this.model.get(this.column.get("name"));

    if(rawValue && !_.isEmpty(rawValue)){
      var i = 0;
      _.each(rawValue, function(val){
        var interpolatedVal = Iccbl.formatString(self.hrefTemplate, self.model, val);
        if(i>0) self.$el.append(', ');
        self.$el.append($('<a>', {
          tabIndex : -1,
          href : interpolatedVal,
          title : val,
          target : self.target
        }).text(val));
        i++;
      });
    }
    return this;
  },

});

var ImageCell = Iccbl.ImageCell = Iccbl.BaseCell.extend({

  className : "image-cell",

  events : {
      "click #link" : "toLink",
  },

  initialize : function(options) {
    ImageCell.__super__.initialize.apply(this, arguments);
  },

  render : function() {
      this.$el.empty();
      this.$el.html(this.render_image());
      this.delegateEvents();
      return this;
  },

  render_image: function(){
    var val = this.model.get(this.column.get('name'));
    if (!_.isEmpty(val)){
      return '<img src="'+val+'" width="200" alt="" />';
    }else{
      return '';
    }
  },

});

/**
 * @deprecated
 * Render the cell as a link that triggers the MyCollection:detail event
 *
 */
var EditCell = Iccbl.EditCell = Iccbl.BaseCell.extend({

  className : "detail-cell",

  events : {
    "click #edit" : "editDetail",
  },

  initialize : function(options) {
    this.options = options;
    EditCell.__super__.initialize.apply(this, arguments);
  },

  render : function() {
    this.$el.empty();
    var formattedValue = this.formatter.fromRaw(
      this.model.get(this.column.get("name")));
    this.$el.append($("<a id='edit' >", {
      tabIndex : -1,
      href : '',
      title : formattedValue,
      // target : "_blank"
    }).text(formattedValue));

    this.delegateEvents();
    return this;
  },

  editDetail : function(e) {
    e.preventDefault();
    if(_.has(this.model, 'clickHandler')){
      this.model.clickHandler(this.model);
    }else{
      this.model.collection.trigger("MyCollection:detail", this.model);
    }
  },
});

var NumberFormatter = Iccbl.NumberFormatter = Backgrid.NumberFormatter;

var IntegerFormatter = Iccbl.IntegerFormatter = function () {
  Backgrid.NumberFormatter.apply(this, arguments);
};

IntegerFormatter.prototype = new Backgrid.NumberFormatter();

_.extend(IntegerFormatter.prototype, {

  defaults: _.extend({}, NumberFormatter.prototype.defaults, {
    decimals: 0,
    // orderSeparator: defines the "thousands" separator to use when displaying:
    // NOTE: specify blank string using display_options.orderSeparator to eliminate
    // the thousands separator. (display_options == cell_options)
    orderSeparator: ',', 
  })
});

var NumberCell = Iccbl.NumberCell = Backgrid.NumberCell.extend({

  initialize: function (options) {

    NumberCell.__super__.initialize.apply(this, arguments);
    
    var self = this;
    var model = this.model;
    var column = this.column;
    model.on('change:'+column.get("name") , function(){
      if (!_.isUndefined(model.previous(column.get("name")))){
        if (parseFloat(currVal) !== parseFloat(model.get(column.get("name")))) {
          self.$el.addClass('edited');
        }
      }
    });
  }
});

var IntegerCell = Iccbl.IntegerCell = Iccbl.NumberCell.extend({
  formatter: IntegerFormatter,
  decimals: 0
});


var DecimalFormatter = Iccbl.DecimalFormatter = function () {
  Backgrid.NumberFormatter.apply(this, arguments);
};

DecimalFormatter.prototype = new Backgrid.NumberFormatter();

_.extend(DecimalFormatter.prototype, {

  defaults: _.extend({}, NumberFormatter.prototype.defaults, {
    // If True, allow trailing zeros, only relevant if not using rounding
    trailing_zeros: false,
    use_rounding: true
  }),

  /**
   * Override Backgrid.NumberFormatter to:
   * - pass non-numbers through
   * - use rounding instead of fixed decimal truncation by default
   */
  fromRaw: function (number, model) {
    if (this.no_format) return number;
    if (_.isNull(number) || _.isUndefined(number)) return null;
    if (_.isString(number) && _.isEmpty(number)) return null;
    if (!_.isNumber(number)){
      try {
        number = parseFloat(number);
      } catch(e){
        console.log('not a number: ' + number + ', ex:' + e);
        return number;
      }
    }
    if (this.use_rounding == true){
      number = round(number, this.decimals);
    } else {
      number = number.toFixed(~~this.decimals);
      if (this.trailing_zeros == false){
        number = number*1;
      }
    }
    number = ''+number;

    var parts = number.split('.');
    var integerPart = parts[0];
    var decimalPart = parts[1] ? (this.decimalSeparator || '.') + parts[1] : '';

    return integerPart.replace(this.HUMANIZED_NUM_RE, '$1' + this.orderSeparator) + decimalPart;

  }
});

/**
 * A number formatter that converts a floating point number, optionally
 * multiplied by a multiplier, to a units string and vice versa.
 *
 * @class Backgrid.UnitsFormatter
 * @extends Backgrid.NumberFormatter
 * @constructor
 * @throws {RangeError}
 *           If decimals < 0 or > 20.
 */
var SIUnitsFormatter = Iccbl.SIUnitsFormatter = function () {
 Backgrid.NumberFormatter.apply(this, arguments);
};


SIUnitsFormatter.prototype = new Backgrid.NumberFormatter();

_.extend(SIUnitsFormatter.prototype, {

  /**
   * @member Backgrid.UnitsFormatter
   * @cfg {Object} options
   *
   * @cfg {number} [options.multiplier=1] The number used to multiply the model
   *      value for display.
   *
   * @cfg {string} [options.symbol='%'] The symbol to append to the Unitsage
   *      string.
   */
  defaults: _.extend({}, NumberFormatter.prototype.defaults, {
    siunits: [
      ['T', 1e12],
      ['G', 1e9],
      ['M', 1e6],
      ['k', 1e3],
      ['', 1],
      ['m', 1e-3,],
      ['u', 1e-6,],
      ['μ', 1e-6,],
      ['n', 1e-9 ],
      ['p', 1e-12 ]
      ],
    multiplier: 1,
    trailing_zeros: false, // If True, allow trailing zeros
    use_rounding: true
  }),

  SI_UNIT_PATTERN: /([\d\.]+)\s*((\w|\xB5|\x{03BC})\w)?/i,

  /**
   * Extends Backgrid.NumberFormatter to support SI Units.
   * Takes a raw value from a model and returns an optionally formatted string.
   *
   * NOTE: precision is lost; input string values are converted to floating
   * point numbers.
   *
   * Convert input to a floating point number, where the number is first multiplied by
   * `multiplier`, then converted to a formatted string like
   * NumberFormatter#fromRaw, then finally append `symbol` to the end.
   */
  fromRaw: function (number, model) {

    if (_.isNull(number) || _.isUndefined(number)) return '';
    if (_.isString(number) && _.isEmpty(number)){
      return null;
    }

    return this.getUnit(number, this.multiplier, this.symbol, this.decimals);
  },

  /**
   * Return the best match SI Unit (unit_symbol,unit_val) for the default_unit_value,
   * such that:
   * default_unit_value can be represented a number between 1 and 1000;
   * (best_match_symbol_val)<=default_unit_value<(next_higher_symbol_val)
   */
  getSIUnit: function(default_unit_value) {
    var pairUnit = _.find(this.siunits, function(pair){
      return pair[1] <= Math.abs(default_unit_value);
    });

    return pairUnit;
  },

  /**
   * Convert the number to a siunit value
   */
  getUnit: function(rawNumber, multiplier, symbol, decimals) {
    var self = this;
    if(!_.isNumber(rawNumber)){
      try{
        number = parseFloat(rawNumber);
      }catch(e){
        console.log('not a number: ' + rawNumber+ ', ex:' + e);
        return rawNumber;
      }
    }else{
      number = rawNumber;
    }
    if(number == 0 ) return number;
    if(!_.isNumber(multiplier)){
      try{
        multiplier = parseFloat(multiplier);
      }catch(e){
        console.log('not a number - multiplier: ' + multiplier+ ', ex:' + e);
      }
    }
    if(multiplier > 0){
      number = number * multiplier;
    }else{
      console.log("Error, DecimalCell multiplier ! > 0: " + multiplier);
    }

    var pairUnit = self.getSIUnit(number);
    // 20180423 - If defaultUnit is set and less than the number, use it:
    // Test the SIUnit to make sure it does not result in a 0 display value;
    // if it does, use the recommended SIUnit
    if (_.isNumber(self.defaultUnit) && number >= self.defaultUnit ){
      var test_pairUnit = self.getSIUnit(self.defaultUnit);
      var test_val = (1/test_pairUnit[1])*number;
      test_val = test_val.toFixed(decimals)*1;
      if (test_val != 0){
        pairUnit = test_pairUnit;
      }
    }

    if(_.isUndefined(pairUnit)){
      console.log('could not find units for the input number: ' + number);
      return number;
    }

    var val = (1/pairUnit[1])*number;

    if (self.use_rounding == false){
      // NOTE: use truncate to match current Screensaver functionality
      // NOTE: "~~" is equivalent to Math.floor()
      val = val.toFixed(~~decimals);
      if( self.trailing_zeros == false){
        val = val*1;
      }
    } else {
      val = round(val, decimals);
      //      val = Math.round(val*Math.pow(10,decimals))/Math.pow(10,decimals);
    }

    var formattedValue = '' + val + ' ' + pairUnit[0] + symbol;
    return formattedValue;
  },


  /**
   * Extends Backgrid.NumberFormatter to support SI Units.
   *
   * Takes a formatted string, usually from user input, and returns a
   * number for persistence in the model.
   *
   * NOTE: precision is lost with zero padding;
   * NumberFormatter converts string values to number values.
   */
  toRaw: function (formattedValue, model) {
    var self = this;
    var tokens;
    var rawValue, scaledRawValue;
    var unitMultiplier;

    if (formattedValue === '') return null;

    var match = this.SI_UNIT_PATTERN.exec(formattedValue);
    if (!match){
      throw 'SI Unit value not recognized' + formattedValue;
    }
    var originalNumberPart = match[1];
    rawValue = NumberFormatter.prototype.toRaw.call(this,originalNumberPart);
    var pairUnit = [self.defaultSymbol, self.defaultUnit];
    if (match.length==4){
      var unit = match[3].toLowerCase();
      pairUnit = _.find(self.siunits, function(pair){
        return pair[0] == unit;
      });
    }

   unitMultiplier = pairUnit[1];

    var originalPrecision = 0;
    if (originalNumberPart.indexOf('.')>-1){
      originalPrecision = (originalNumberPart + "").split(".")[1].length;
    }

    // use the multiplier to scale the raw value
    newRawValue = rawValue / this.multiplier;
    // use the SIUnit to scale the raw value
    newRawValue= rawValue*unitMultiplier;

    // Truncate or pad the precision to the decimal setting
    var allowedPrecision = this.decimals;
    var desiredPrecision = originalPrecision;
    if (unitMultiplier < 1){
      allowedPrecision += (unitMultiplier + "").split(".")[1].length;
      desiredPrecision += (unitMultiplier + "").split(".")[1].length;
    }
    newRawValue = newRawValue.toFixed(allowedPrecision)*1;

    var newPrecision = 0;
    if ( (newRawValue+"").indexOf(".") > -1){
      newPrecision = (newRawValue+"").split(".")[1].length;
    }
    if (newPrecision < desiredPrecision){
      if (desiredPrecision < allowedPrecision){
        newRawValue = newRawValue.toFixed(desiredPrecision);
      }else{
        newRawValue = newRawValue.toFixed(allowedPrecision);
      }
    }

    // Convert to string to finalize precision with subsequent serialization
    return "" + newRawValue;
  },

});

/**
 * A DecimalCell is another Backgrid.NumberCell that takes a floating number,
 * and showing a decimals number of digits.
 *
 * @class Backgrid.DecimalCell
 * @extends Backgrid.NumberCell
 */
var DecimalCell = Iccbl.DecimalCell = NumberCell.extend({

  /** @property */
  className: "decimal-cell",

  /** @property {Backgrid.CellFormatter} [formatter=Backgrid.NumberFormatter] */
  formatter: DecimalFormatter,

  /**
   * Initializes this cell and the Units formatter.
   *
   * @param {Object}
   *          options
   * @param {Backbone.Model}
   *          options.model
   * @param {Backgrid.Column}
   *          options.column
   */
  initialize: function () {
    DecimalCell.__super__.initialize.apply(this, arguments);
    this.formatter.decimals = this.decimals;
    this.formatter.no_format = this.no_format;
  }

 });

/**
 * A SIUnitsCell is another Backgrid.NumberCell that takes a floating number,
 * optionally multiplied by a multiplier, showing a decimals number of digits,
 * and displayed with a units symbol.
 *
 * @class Backgrid.SIUnitsCell
 * @extends Backgrid.NumberCell
 */
var SIUnitsCell = Iccbl.SIUnitsCell = NumberCell.extend({

  /** @property */
  className: "units-cell",

  /** @property {number} [multiplier=1] */
  multiplier: SIUnitsFormatter.prototype.defaults.multiplier,

  /** @property {string} [symbol='%'] */
  symbol: SIUnitsFormatter.prototype.defaults.symbol,

  /** @property {Backgrid.CellFormatter} [formatter=Backgrid.UnitsFormatter] */
  formatter: SIUnitsFormatter,

  /**
   * Initializes this cell and the Units formatter.
   *
   * @param {Object}
   *          options
   * @param {Backbone.Model}
   *          options.model
   * @param {Backgrid.Column}
   *          options.column
   */
  initialize: function () {
    SIUnitsCell.__super__.initialize.apply(this, arguments);
    var formatter = this.formatter;
    formatter.multiplier = this.multiplier;
    formatter.decimals = this.decimals;
    formatter.symbol = this.symbol;
    formatter.defaultUnit = this.defaultUnit;
  }

});

var SelectCell = Iccbl.SelectCell = Backgrid.SelectCell.extend({

  className: '',

  initialize: function(){

    SelectCell.__super__.initialize.apply(this, arguments);
    var self = this;
    this.model.on('change:'+this.column.get("name") , function(){
      // Block updates caused by adding columns
      if (!_.isUndefined(self.model.previous(self.column.get("name")))){
        self.$el.addClass('edited');
      }
    });
  },

  /**
   * override Backgrid.SelectCell:
   * - render to return the cell value if optionValues is malformed or missing
   * the value
   */
  render: function () {
    this.$el.empty();

    var optionValues = _.result(this, "optionValues");
    var model = this.model;
    var rawData = this.formatter.fromRaw(
      model.get(this.column.get("name")), model);
    var selectedText = [];

    if (_.isArray(optionValues) &&  !_.isEmpty(optionValues)){
      for (var k = 0; k < rawData.length; k++) {
        var rawDatum = '' + rawData[k];
        for (var i = 0; i < optionValues.length; i++) {
          var optionValue = optionValues[i];
          if (_.isArray(optionValue)) {
            var optionText  = optionValue[0];
            var optionValue = optionValue[1];
            if (optionValue.toLowerCase() == rawDatum.toLowerCase()){
              selectedText.push(_.escape(optionText));
            }
          }
          else if (_.isObject(optionValue)) {
            var optionGroupValues = optionValue.values;
            for (var j = 0; j < optionGroupValues.length; j++) {
              var optionGroupValue = optionGroupValues[j];
              if (optionGroupValue[1].toLowerCase() == rawDatum.toLowerCase()) {
                selectedText.push(_.escape(optionGroupValue[0]));
              }
            }
          }
          else {
            throw new TypeError;
          }
        }
      }
    }
    var isEmpty = (
        _.isEmpty(rawData)
        || (_.isArray(rawData) && rawData.length == 1 && _.isEmpty(rawData[0])));
    if( !isEmpty && _.isEmpty(selectedText)){
      selectedText = rawData;

      Iccbl.appModel.error(Iccbl.formatString(
        'column: {column}, vocabulary: {vocabulary} is misconfigured: rawData: "{rawData}"',
        { column: this.column.get("name"),
          vocabulary: _.result(this, "vocabulary_scope_ref"),
          rawData: rawData
        }));
      console.log(Iccbl.formatString(
        'column: {column}, vocabulary: {vocabulary} is misconfigured,'
          + 'rawData: "{rawData}", optionValues: {optionValues}',
        { column: this.column.get("name"),
          vocabulary: _.result(this, "vocabulary_scope_ref"),
          rawData: rawData,
          optionValues: optionValues
        }));
    }
    var finalText = selectedText.join(this.delimiter);

    if(!_.isUndefined(this.hrefTemplate)){
      // hack - if hrefTemplate is defined, treat this like a link cell - 20150828
      var target = this.target || "_self";
      var interpolatedVal = Iccbl.formatString(this.hrefTemplate,this.model);
      this.$el.append($('<a>', {
        tabIndex : -1,
        href : interpolatedVal,
        target : this.target
      }).text(finalText));

    }else{
      this.$el.append(finalText);
    }

    this.delegateEvents();

    return this;
  }

});

/**
 * Override Backgrid DateTimeFormatter
 * - recognize user input in the format MM/DD/YYYY
 * - but also recognize ISO 8601 format, so values from the server are parsed
 */
var DatetimeFormatter = Iccbl.DatetimeFormatter = function (options) {
  _.extend(this, this.defaults, options || {});

  if (!this.includeDate && !this.includeTime) {
    throw new Error("Either includeDate or includeTime must be true");
  }
};

DatetimeFormatter.prototype = new Backgrid.DatetimeFormatter();
_.extend(DatetimeFormatter.prototype, {

  fromRaw: function (rawData, model) {
    if (_.isNull(rawData) || _.isUndefined(rawData)) return '';
    rawData = rawData.trim();
    if ((rawData + '').trim() === '') return null;

    return getIccblDateString(Iccbl.dateParse(rawData));
  },

  toRaw: function(formattedData, model){
    if (_.isNull(formattedData) || _.isUndefined(formattedData)) return '';
    if ((formattedData + '').trim() === '') return null;
    if(ICCBL_DATE_RE.test(formattedData)){
      var MMDDYYYY = ICCBL_DATE_RE.exec(formattedData) || [];
      var jsDate = new Date(
        MMDDYYYY[3] * 1 || 0,
        MMDDYYYY[1] * 1 - 1 || 0,
        MMDDYYYY[2] * 1 || 0);
      var temp = getISODateString(jsDate);
      return temp;
    }else{
      return;
    }
  },

  /**
   * Modify Backgrid DatetimeFormatter convert:
   * - ignore timezone - remove UTC conversion
   * - add in ICCBL_DATE_RE
   * TODO: refactor, using Iccbl.dateParse
   */
  _convert: function (data, validate) {
    if ((data + '').trim() === '') return null;

    var date, time = null;
    if (_.isNumber(data)) {
      var jsDate = new Date(data);
      date = lpad(jsDate.getFullYear(), 4, 0)
        + '-' + lpad(jsDate.getMonth() + 1, 2, 0)
        + '-' + lpad(jsDate.getDate(), 2, 0);
      time = lpad(jsDate.getHours(), 2, 0)
        + ':' + lpad(jsDate.getMinutes(), 2, 0)
        + ':' + lpad(jsDate.getSeconds(), 2, 0);
      // modified 20150831 - use local date/time
      //date = lpad(jsDate.getFullYear(), 4, 0) + '-' + lpad(jsDate.getMonth() + 1, 2, 0) + '-' + lpad(jsDate.getDate(), 2, 0);
      //time = lpad(jsDate.getHours(), 2, 0) + ':' + lpad(jsDate.getMinutes(), 2, 0) + ':' + lpad(jsDate.getUTCSeconds(), 2, 0);
    }
    else {
      data = data.trim();
      var parts = data.split(ISO_SPLITTER_RE) || [];
      date = ICCBL_DATE_RE.test(parts[0]) ? parts[0] : '';
      time = date && parts[1] ? parts[1] : TIME_RE.test(parts[0]) ? parts[0] : '';
    }
    // FIXME: review this
    var MMDDYYYY = ICCBL_DATE_RE.exec(date) || [];
    var HHmmssSSS = TIME_RE.exec(time) || [];

    if (validate) {
      if (this.includeDate && _.isUndefined(MMDDYYYY[0])) return;
      if (this.includeTime && _.isUndefined(HHmmssSSS[0])) return;
      if (!this.includeDate && date) return;
      if (!this.includeTime && time) return;
    }

    var jsDate = new Date(MMDDYYYY[3] * 1 || 0,
                                   MMDDYYYY[1] * 1 - 1 || 0,
                                   MMDDYYYY[2] * 1 || 0,
                                   HHmmssSSS[1] * 1 || null,
                                   HHmmssSSS[2] * 1 || null,
                                   HHmmssSSS[3] * 1 || null,
                                   HHmmssSSS[5] * 1 || null);

    var result = '';

    if (this.includeDate) {
      result = ( getIccblDateString(jsDate) );
    }

    if (this.includeTime) {
      result = ( result
          + (this.includeDate ? 'T' : '')
          + lpad(jsDate.getHours(), 2, 0)
          + ':' + lpad(jsDate.getMinutes(), 2, 0)
          + ':' + lpad(jsDate.getSeconds(), 2, 0)
          );

      if (this.includeMilli) {
        result = result + '.' + lpad(jsDate.getMilliseconds(), 3, 0);
      }
    }

    if (this.includeDate && this.includeTime) {
      result += "Z";
    }
    return result;
  },

});

/**
 * DateCellEditor replacement:
 * - bootstrap-datepicker editor
 * - use bootstrap-datepicker to convert user input to a JavaScript Date
 */
var DateCell2Editor = Iccbl.DateCell2Editor = Backgrid.CellEditor.extend({

  template: [
     '  <input type="text" class="form-control" >',
     ].join(''),

  initialize: function (options) {
    DateCell2Editor.__super__.initialize.apply(this, arguments);
    _.bindAll(this, 'saveOrCancel', 'postRender');

    this.value = new Date(this.model.get(this.column.get('name')));
  },

  setValue: function(value) {
    $('input', this.el).datepicker('setUTCDate', value);
  },

  getValue: function() {
      var input = $('input', this.el);
      var date = input.datepicker('getDate');
      try{
        return Iccbl.getISODateString(date);
      } catch(e) {
        console.log('invalid date', e, date);
        return date;
      }
  },

  /**
     Renders a text input with the cell value formatted for display, if it
     exists.
  */
  render: function () {
    var el = $(this.el);
    el.html(this.template);

    var input = $('input', el);
    input.datepicker({
        dateFormat: 'dd/mm/yyyy',
        autoclose: true,
        todayBtn: 'linked',
        todayHighlight: true,
        orientation: "bottom auto"
    }).on('hide', this.saveOrCancel);

    // manually get the input-group-addon click
    $('#datepicker-icon',el).click(function(e) {
      input.datepicker().focus();
    });
    this.setValue(this.value);

    return this;
  },

  saveOrCancel: function (e) {
    var model = this.model;
    var column = this.column;
      var newValue = this.getValue();
      model.set(column.get("name"), newValue);
      var NewCommand = function() {};
      NewCommand.prototype = new Backgrid.Command(e);
      _.extend(NewCommand.prototype, {
        save: function(){ return true; }
      });
      var command = new NewCommand(e);
      model.trigger("backgrid:edited", model, column, command);
  },

  postRender: function (model, column) {
    if (column == null || column.get("name") == this.column.get("name")) {
      // move the cursor to the end on firefox if text is right aligned
      if (this.$el.css("text-align") === "right") {
        var val = this.$el.val();
        this.$el.focus().val(null).val(val);
      }
      else this.$el.focus();
    }
    return this;
  }
});

/**
 * DateCell replacement:
 * - bootstrap-datepicker editor
 * - simplified date serialization:
 * - bypass the Backgrid.DateTimeFormatter on fromRaw,
 * - use bootstrap-datepicker to convert user input to a JavaScript Date
 */
var DateCell2 = Iccbl.DateCell2 = Backgrid.Cell.extend({

  initialize: function(){
    Iccbl.DateCell2.__super__.initialize.apply(this, arguments);
    var self = this;
  },

  /**
     Render a text string in a table cell. The text is converted from the
     model's raw value for this cell's column.
  */
  render: function () {
    var $el = this.$el;
    $el.empty();
    var model = this.model;
    var columnName = this.column.get("name");
    $el.text(this.fromRaw(model.get(columnName), model));
    $el.addClass(columnName);
    this.updateStateClassesMaybe();
    this.delegateEvents();
    return this;
  },

  /**
   * Convert model value to display:
   * - simplified from the Backgrid.DateTimeFormatter.fromRaw
   */
  fromRaw: function (rawData, model) {

    if (_.isNull(rawData) || _.isUndefined(rawData)) return '';
    if (_.isDate(rawData)){
      return getIccblDateString(rawData);
    } else {
      rawData = rawData.trim();
      if ((rawData + '').trim() === '') return null;

      return getIccblDateString(Iccbl.dateParse(rawData));
    }
  },

  isEditable: function() {
    return Backgrid.callByNeed(this.column.editable(), this.column, this.model);
  },

  enterEditMode: function () {
    var model = this.model;
    var column = this.column;

    if (this.isEditable()) {

      // ICCBL-Hack to stop the column from resizing on entering edit mode
      // https://github.com/cloudflare/backgrid/issues/489
      this.$el.width((this.$el.outerWidth()) + 'px');

      this.currentEditor = new DateCell2Editor({
        model: model,
        column: column
      });

      model.trigger("backgrid:edit", model, column, this, this.currentEditor);

      // Need to redundantly undelegate events for Firefox
      this.undelegateEvents();
      this.$el.empty();
      this.currentEditor.render();
      this.$el.append(this.currentEditor.$el);
      this.$el.addClass("editor");

      model.trigger("backgrid:editing", model, column, this, this.currentEditor);
    }
  },

  /**
     Removes the editor and re-render in display mode.
  */
  exitEditMode: function () {
    this.$el.removeClass("error");
    this.currentEditor.remove();
    this.stopListening(this.currentEditor);
    delete this.currentEditor;
    this.$el.removeClass("editor");
    this.render();
  }

});



/**
 * Override DateCell
 * - set the format to MM/DD/YYYY
 * @deprecated use DateCell2 instead
 */
var DateCell = Iccbl.DateCell = Backgrid.DateCell.extend({

  /** @property {Backgrid.CellFormatter} [formatter=Backgrid.DatetimeFormatter] */
  formatter: DatetimeFormatter,

  /**
  Initializes this cell and the datetime formatter.

  @param {Object} options
  @param {Backbone.Model} options.model
  @param {Backgrid.Column} options.column
  */
  initialize: function (options) {
    var self = this;
    // Note __super__ == Backgrid.DateCell.prototype
    DateCell.__super__.initialize.apply(this, arguments);
    var formatter = this.formatter;
    //   formatter.includeDate = this.includeDate;
    formatter.includeTime = false;
    //   formatter.includeMilli = this.includeMilli;

    var placeholder = "MM/DD/YYYY";

    this.editor = this.editor.extend({
      attributes: _.extend(
          {}, this.editor.prototype.attributes, this.editor.attributes, {
            placeholder: placeholder
          })
    });

    this.model.on('change:'+this.column.get("name") , function(){
      // Block updates caused by adding columns
      if (!_.isUndefined(self.model.previous(self.column.get("name")))){
        self.$el.addClass('edited');
      }
    });
  }

});

/**
 * uses the options.attributes.label
 */
var DeleteCell = Iccbl.DeleteCell = Iccbl.BaseCell.extend({
  className: "delete-cell",
  events : {
  "click #delete" : "delete"
  },

  initialize: function(options){
    DeleteCell.__super__.initialize.apply(this, arguments);
  },

  render: function () {
    this.$el.empty();

    this.$el.append("&nbsp;");
    this.$el.append(
      $("<a id='delete' >", {
        tabIndex : -1,
        href : '',
      }).text(this.column.attributes['text']));
    this.delegateEvents();
    return this;
  },

  delete: function(e) {
    e.preventDefault();
    this.model.collection.trigger("MyCollection:delete", this.model);
  }
});

/**
 * Extend a LinkCell, with a comment mouse over.
 */
var CommentArrayLinkCell = Iccbl.CommentArrayLinkCell = Iccbl.LinkCell.extend({
  /*
   * @property {string} [comment_attribute='comment_array'] The model
   * attribute containing the apilog comment_array
   */
  comment_attribute: 'comment_array',

  /*
   * Provide a title for generated dialog
   */
  title_function: function(model){
    return 'Comments'; // + ': ' + Iccbl.getIdFromIdAttribute(model, resource)
  },

  render: function(){
    var self = this;
    Iccbl.LinkCell.prototype.render.apply(this, arguments);
    var comments = this.model.get(self.comment_attribute);
    if (!_.isEmpty(comments)){
      comments = Iccbl.parseComments(comments);
      this.$el.attr('title',comments);
      this.$el.append(Iccbl.createCommentIcon(
        comments,
        self.title_function(self.model)));
    }
    return this;
  }
});


var CollectionInColumns = Iccbl.CollectionInColumns = Backbone.Collection.extend({
  /**
   * Override collection parse method: Parse server response data.
   */
  parse : function(response) {
    if (Iccbl.appModel.DEBUG) console.log('Collection on client, parse called');
    var pivoted = {};
    var i = 0;
    _.each(response.objects, function(obj) {
      _.pairs(obj, function(pair) {
        if (_.has(pivoted, pair[0])) {
          pivoted[pair[0]] = {};
        }
        pivoted[pair[0]][i] = pair[1];
      });
      i++;
    });
    return _.values(pivoted);
  },
});

var UriContainerView = Iccbl.UriContainerView = Backbone.Layout.extend({

  initialize: function(args) {
    if (Iccbl.appModel.DEBUG) console.log('initialize UriContainerView');
    var model = this.model = args.model;
    var targetProperty = args.property || 'uriStack';
    this.listenTo(model, 'change:'+targetProperty , this.uriStackChange );

    Backbone.Layout.prototype.initialize.apply(this,arguments);
  },

  /**
   * This method will report URI stack change events from child views.
   */
  reportUriStack: function(reportedUriStack, options) {
    var options = options || {source: this};
    var consumedStack = this.consumedStack || [];
    if (reportedUriStack){
      actualStack = consumedStack.concat(reportedUriStack);
    }else{
      actualStack = consumedStack.slice(0);
    }
    Iccbl.appModel.reportUriStack(actualStack, options);
  },

  /**
   * Backbone.Model change event handler
   *
   * @param options.source =
   *          the event source triggering view
   */
  uriStackChange: function(model, val, options) {
    if(options && options.source === this){
      if (Iccbl.appModel.DEBUG) console.log('UriContainerView: self generated uristack change');
      return;
    }else{
      var uriStack = _.clone(this.model.get('uriStack'));
      try {
        this.changeUri(uriStack);
      }catch (e){
        console.log('error thrown: ',e);
        Iccbl.appModel.error('error: ' + e);
      }
    }
  },

  changeUri: function(uriStack) {
    window.alert(
      'ContentView changeUri function must be implemented. uriStack: ' +
      JSON.stringify(uriStack));
  }
});

var MultiSortBody = Iccbl.MultiSortBody = Backgrid.Body.extend({

  /**
   * See Backgrid.Body.sort: - created to solve the multisort case for the
   * server side backbone-pageable collection only. triggered by "backgrid:sort" -
   * sent from the column header cells.
   */
  sort: function (column, direction) {
    if (_.isString(column)) column = this.columns.findWhere({name: column});

    if (Iccbl.appModel.DEBUG){
      console.log('MultiSortBody.sort( ' + column.get('name') + ', ' + direction);
    }

    var collection = this.collection;
    var order;
    if (direction === "ascending") order = -1;
    else if (direction === "descending") order = 1;
    else order = null;

    collection.setSorting(column.get("name"), order,
        {sortValue: column.sortValue()});
    collection.fetch({
      reset: true,
      success: function () {
        if (Iccbl.appModel.DEBUG) console.log('fetch success, direction: ' + direction);
        collection.trigger("backgrid:sorted", column, direction, collection);
      }
    }).fail(function(){ Iccbl.appModel.jqXHRfail.apply(this,arguments); });

    column.set("direction", direction);

    return this;
  }
});

var MyCollection = Iccbl.MyCollection = Backbone.PageableCollection.extend({

  initialize : function(options) {
    var self = this;
    this.options = options;
    Backbone.PageableCollection.prototype.initialize.apply(this, options);

    // Define an order_by callback for backbone.paginator:
    // backbone.paginator will "map extra query parameters" when performing fetch
    this.queryParams.order_by = function(){
      // Note: the orderStack is converted using "traditional" array serialization:
      // see: http://api.jquery.com/jQuery.param/
      return self.listModel.get('order');
    }
  },

  mode: 'server',

  url : function() {
      return this.url;
  },
  searchHash : {},
  model : MyModel,
  state : {
    pageSize : 25,  // TODO: probably not necessary
  },

  // PageableCollection.fetch() uses the queryParams attribute to interpret
  // the server response and to determine the data hash sent to the server.
  // Adjust the query params for tastypie.
  queryParams : {
    pageSize : 'limit',
    offset : function() {
      return (this.state.currentPage - 1) * this.state.pageSize;
    },
    use_vocabularies: null, // this signals to the api to replace out
                            // vocabularies - FIXME: make this a setting?
    totalRecords : null, // unset for tastypie
    totalPages : null, // unset for tastypie
    //    sortKey : "order_by", // modified for tastypie
    order : null, // unset for tastypie
    includes: function(){
      var temp = this.listModel.get('includes');
      if (!_.isEmpty(this.extraIncludes)){
        temp = _.union(temp,this.extraIncludes);
      }
      return temp;
    }
  },

  /**
   * Override
   */
  parseState : function(response, queryParams, state, options) {
    // Adjust for expected response from server:
    var state = _.clone(state);
    var meta = _.result(response,Iccbl.appModel.API_RESULT_META);
    if (!meta){
      console.log('error no meta: ', response);
      msg = 'error in response: no "' + Iccbl.appModel.API_RESULT_META + '"';
      Iccbl.appModel.error(msg);
      throw msg;
    }
    if(! _.isNumber(meta.total_count)){
      msg = 'error "total_count" not found in meta: ', meta;
      Iccbl.appModel.error('error in server response');
      throw msg;
    }
    state.totalRecords = response.meta.total_count;

    // FIXME: having to set this for the pre-fetched collections
    if(!_.isNumber(state.firstPage)) state.firstPage = 1;

    if (Math.ceil(state.totalRecords / state.pageSize) < state.currentPage) {
      state.currentPage = 1;
    }
    return state;
  },

  /**
   * Override
   */
  parseRecords: function (resp, options) {
    if (Iccbl.appModel.API_RESULT_DATA){
      return resp[Iccbl.appModel.API_RESULT_DATA];
    } else {
      return resp.objects;
    }
  },

  /**
   * Method for external callers to set the search, with fetch
   * @param options - for Backbone.Collection.fetch:
   * { reset: false } (default) - uses set to (intelligently) merge the fetched
   * models ("add" events are fired),
   * {reset: true}, in which case the collection will be (efficiently) reset
   * (no "add" events will be fired)
   */
  setSearch: function(searchHash, options) {
    var self = this;
    var searchHash = _.clone(searchHash);
    self.listModel.set(Iccbl.appModel.URI_PATH_SEARCH, searchHash);

    // Tell all the header cells
    this.trigger("MyServerSideFilter:search", searchHash, this);

    // TODO: debug: "_data" is not needed
    // backbone.paginator should translate all queryparams into "data" in the
    // fetch method
    //
    // Allow searches that aren't for a visible column:
    // - if the search key is not in the queryParams, then it is not a column
    // - this will add it manually to the queryParams (which are serialized in
    // the fetch to the server).
    _.each(_.keys(searchHash), function(key) {
      var val = searchHash[key]
      if(_.isEmpty("" + val)){
          delete self.queryParams[key];
      }else{
        if (_.isString(val)){
          val = val.trim();
        }
        // Check if param dne, or if param exists and is a value to be set.
        // The reason for the "isFunction" check is that the Backgrid-filter
        // defined params are function calls to get the current value in the
        // searchbox - so skip those as state is stored there.
        if (!_.has(self.queryParams, key) || !_.isFunction(self.queryParams[key])) {
        	// Make the params persistent (if not a backgrid-filter)
          self.queryParams[key] = function () {
            var search = self.listModel.get(Iccbl.appModel.URI_PATH_SEARCH);
            if (!_.isEmpty(search)){
              return _.result(search, key, null);
            }
            return null;
          };
        }
      }
    });

    //self.fetch({reset: true}).fail(
    if (_.result(options, 'fetch') !== false){
      self.fetch(options).fail(
        function(){ Iccbl.appModel.jqXHRfail.apply(this,arguments);}
      );
    }
  },

  /**
   * Proxy for the search elements to add search terms to the listModel,
   * if options.reset == true, then fetch, otherwise no fetch.
   */
  addSearch: function(searchHash, options) {
    console.log('addSearch: ' + JSON.stringify(searchHash)
      + ', options: ' + JSON.stringify(options) );
    var self = this;
    var newSearchHash = _.clone(self.listModel.get(Iccbl.appModel.URI_PATH_SEARCH));
    newSearchHash = _.extend(newSearchHash, searchHash);
    if(options && options.reset && self.state.currentPage != 1){
      self.state.currentPage = 1;
    }
    self.listModel.set(Iccbl.appModel.URI_PATH_SEARCH, newSearchHash);
  },

  /**
   * Proxy for the search elements to clear search terms from the listModel on
   * the collection.
   * if options.reset == true, then fetch, otherwise no fetch.
   */
  clearSearch: function(searchKeys, options) {
    if (Iccbl.appModel.DEBUG){
      console.log('clearsearch: ' + JSON.stringify(searchKeys)
        + ', options: ' + JSON.stringify(options) );
    }
    var self = this;
    var searchHash = {};
    var found = false;
    if (!_.isUndefined(searchKeys)) {
      searchHash = _.clone(self.listModel.get(Iccbl.appModel.URI_PATH_SEARCH));
      _.each(searchKeys, function(searchKey) {
        if(_.has(searchHash, searchKey)){
          delete searchHash[searchKey];
          found = true;
        }
      });
    }
    if(found){
      self.state.currentPage = 1;
      var data = {};
      data[Iccbl.appModel.URI_PATH_SEARCH] = searchHash;
      self.listModel.set(data, options);
    }
  },

  /**
   * Override - HeaderCell.onClick -> backgrid:sort -> body.sort -> ->
   * (BackbonePageable)Collection.setSorting -> Collection.fetch() -> grab data
   * from state based on "queryParams"
   */
  setSorting : function(sortKey, order, options) {
    var self = this;
    var state = this.state;

    var orderStack = this.listModel.get('order') || [];

    var newdir = order == 1 ? '-' : order == -1 ? '': null;

    var newStack = [];
    var found = false;

    _.each(orderStack, function(order_entry){
      var dir = order_entry.substring(0,1);
      var fieldname = order_entry;
      if(dir == '-'){
        fieldname = order_entry.substring(1);
      }else{
        dir = '';
      }
      if(fieldname == sortKey){
        found = true;
        if(newdir === null){
          // pop this off
        }else if(newdir == dir){
          // no change; push back on the stack
          newStack.push(order_entry);
        }else if (newdir !== dir){
          newStack.push(newdir + fieldname);
        }
      }else{
        newStack.push(order_entry);
      }
    });

    if(!found && newdir !== null) newStack.push(newdir + sortKey);

    if (Iccbl.appModel.DEBUG){
      console.log('Ordering update: old: ' + JSON.stringify(orderStack)
        + ', new: ' + JSON.stringify(newStack));
    }
    self.listModel.set('order', newStack);

    // Backbone.PageableCollection.prototype.setSorting.call(this, sortKey,
    // order);
	  // TODO: Investigate why PageableCollection.setSorting is not triggering
	  // a 'sort' event (needed to clear old sort indicators).
	  // Sequence of a sort:
	  // Backgrid.HeaderCell.onClick-> collection.trigger('backgrid:sort')
	  // -> 'backgrid:sort' -> Backgrid.Body.sort()
	  // -> PageableCollection.setSorting(): sets state.sortKey
	  // -> if(fullCollection) (client mode) collection.sort()
	  // -> else
	  // -> Collection.fetch(reset:true)
	  // *so in this case, no sort(), if reset:false, then a "set"
	  // would be called, and a 'sort' triggered
	  // * also calls column.set to put the new indicator
	  // column.set('direction')
	  // without a sort, there is no erasing of the old sort indicators:
	  // Collection.sort() -> trigger('sort') ->
	  // -> Backgrid.HeaderCell.removeCellDirection
	  // Last note: this may be caused by not getting the sortKey from the
	  // queryParams on parseState.
  	this.trigger('sort',this);
  },

});

//// Header Cell Definitions /////

//var HeaderCell = Backgrid.HeaderCell.extend({
//  render: function() {
//    if (this.fieldinformation.is_admin){
//      this.$el.addClass('admin-field');
//    }
//  }
//});


var SortableHeaderCell = Iccbl.SortableHeaderCell = Backgrid.HeaderCell.extend({
  ___klass: 'SortableHeaderCell',

  /**
   * Renders a header cell with a sorter and a label.
   * - labels are constrained to 10 characters wide
   */
  render : function() {
    var self = this;
    this.$el.empty();
    var column = this.column;
    var sortable = Backgrid.callByNeed(column.sortable(), column, this.collection);
    if(sortable){
      var label = Iccbl.createLabel(column.get("label"), 10);
      self.sorter = $("<div id='sorter'></div>");
      label = $("<a>" + label +"</a>").append(self.sorter);
    } else {
      // NOTE: using anchor node to set the text color/style the same as other
      // cells
      // label = document.createTextNode(column.get("label"));
      label = $("<a>" + column.get("label") +"</a>");
    }
    this.$el.append(label);
    this.$el.addClass(column.get("direction"));
    this.$el.addClass(column.get("name"));
    this.delegateEvents();

    var mouseover = column.get('description');
    if (column.has('mouseover')){
      mouseover = column.get('mouseover');
    }
    this.$el.prop('title', mouseover);
    
    if (this.fieldinformation && this.fieldinformation.is_admin){
      // TODO: create an admin-field class that mixes in label-warning
      this.$el.append(
        "<span style='margin-bottom: 2px;' "
        + "class='label label-warning label-as-badge pull-right strong' "
        + "title='admin field'>A</span>")
        //      this.$el.addClass('admin-field');
    }
    return this;
  }
});

var MultiSortHeaderCell = Iccbl.MultiSortHeaderCell = SortableHeaderCell.extend({

  ___klass: 'MultiSortHeaderCell',

  initialize : function(options) {
    this.options = options;
    MultiSortHeaderCell.__super__.initialize.apply(this, arguments);

    this.fieldinformation = _.clone(this.column.get('fieldinformation'));

    this.listenTo(this.collection,"sort",this.collectionSorted);
    this.listenTo(this.collection,"Iccbl:clearSorts", this.removeCellDirection);
    _.bindAll(this, '_submit', 'clearSearch');
  },

  // Original onClick, for reference, from Backgrid
  // onClick: function (e) {
  // e.preventDefault();
  //
  // var column = this.column;
  // var collection = this.collection;
  // var event = "backgrid:sort";
  //
  // function cycleSort(header, col) {
  // if (column.get("direction") === "ascending") collection.trigger(event, col,
  // "descending");
  // else if (column.get("direction") === "descending")
  // collection.trigger(event, col, null);
  // else collection.trigger(event, col, "ascending");
  // }
  //
  // function toggleSort(header, col) {
  // if (column.get("direction") === "ascending") collection.trigger(event, col,
  // "descending");
  // else collection.trigger(event, col, "ascending");
  // }
  //
  // var sortable = Backgrid.callByNeed(column.sortable(), column,
  // this.collection);
  // if (sortable) {
  // var sortType = column.get("sortType");
  // if (sortType === "toggle") toggleSort(this, column);
  // else cycleSort(this, column);
  // }
  // },

  // TODO: debounced clicking - sort of working, but...
  // - at this time this method is debouncing on the cell instance:
  // --- no coordination with other headercells
  //
  /**
   * Event handler for the `click` event on the cell's anchor. If the column is
   * sortable, clicking on the anchor will cycle through 3 sorting orderings -
   * `ascending`, `descending`, and default.
   */
  onClick: function (e) {
    var self=this;
    e.preventDefault();
    e.stopPropagation();

    var collection = this.collection;
    var event = "backgrid:sort"
    var column = this.column;

    if(_.isUndefined(this.tempdirection)){
      this.tempdirection = this.column.get("direction");
    }
    if(this.tempdirection == "descending"){
      this.tempdirection = "ascending";
    }else if(this.tempdirection == "ascending"){
      this.tempdirection = "none";
    }else{
      this.tempdirection = "descending";
    }

    this.setCellDirection(
      column, self.tempdirection=="none"?null:self.tempdirection );

    var args = arguments;

    var delayedClick = function(){
      if (Iccbl.appModel.DEBUG) console.log('delayedclick: tempdirection: ' + self.tempdirection);
      if(self.tempdirection !== self.lastExecutedVal){
        collection.trigger(
          event, column, self.tempdirection=="none"?null:self.tempdirection);
        self.lastExecutedVal = self.tempdirection;
      }else{
        if (Iccbl.appModel.DEBUG){
          console.log('this.tempdirection == self.lastExecutedVal: ' + self.lastExecutedVal);
        }
      }
    };
    _.debounce(delayedClick, 1000)();
    // FIXME:
    // Both throttle and debounce seem to work the same;
    // that is they both are working like setTimeout
    // _.throttle(delayedClick, 5000, {leading: false})();

  },

  collectionSorted: function(collection, options){
    var self = this;
    var name = this.column.get('name');

    var i = 0;
    if (this.collection.listModel) {

      var orderStack = this.collection.listModel.get('order') || [];
      _.each(orderStack, function(order_entry){
        i++;
        var dir = order_entry.substring(0,1);
        var direction = null;
        var fieldname = order_entry;
        if(dir == '-'){
          fieldname = order_entry.substring(1);
          direction = 'descending';
        }else{
          dir = '';
          direction = 'ascending';
        }
        if(fieldname == name){
          self.$el.removeClass("ascending").removeClass("descending");
          self.$el.addClass(direction);

          var sorter = self.$el.find('#sorter');
          sorter.empty();
          sorter.append(
           "<span style='margin-bottom: 2px;' class='badge pull-right'>"
           + i + "<b class='sort-caret'></b></span>");
        }
      });
    }
  },

  /**
   * Event handler for the column's `change:direction` event. If this
   * HeaderCell's column is being sorted on, it applies the direction given as a
   * CSS class to the header cell. Removes all the CSS direction classes
   * otherwise.
   */
  setCellDirection: function (column, direction) {
    var self = this;
    var name = column.get('name');
    if (_.result(this.fieldinformation,'filtering') !== true){
      return;
    }
    if(_.isUndefined(direction) || _.isNull(direction)){
      // this.$el.removeClass("ascending").removeClass("descending");
      // this.$el.find("#sorter").empty();
      this.removeCellDirection();
    }else{
      this.$el.removeClass("ascending").removeClass("descending");
      this.$el.addClass(direction);

      var num = 1;
      var orderStack = self.collection.listModel.get('order') || [];
      if (!_.isEmpty(orderStack)) {
        var i = 0;
        var found = _.find(orderStack, function(fieldname){
          i++;
          if(fieldname == name || fieldname == '-' + name){
            num = i;
            return true;
          }
        });
        if(!found){
          num = orderStack.length+1;
        }
      }
      sorterText = $("<span style='margin-bottom: 2px;' class='badge pull-right'>"
          + num + "<b class='sort-caret'></b></span>");

      self.sorter.empty();
      self.sorter.append(sorterText);
    }
  },

  /**
   * Backgrid event handler for the PageableCollection 'sort' event.
   */
  removeCellDirection: function () {
    var self = this;
    this.$el.removeClass("ascending").removeClass("descending");
    if(self.sorter) self.sorter.empty();
  },

//   /**
//   * Renders a header cell with a sorter and a label.
//   */
//  render : function() {
//    var self = this;
//    this.$el.empty();
//    var column = this.column;
//    var sortable = Backgrid.callByNeed(column.sortable(), column, this.collection);
//    if(sortable){
//      var label = Iccbl.createLabel(column.get("label"), 10);
//      self.sorter = $("<div id='sorter'></div>");
//      label = $("<a>" + label +"</a>").append(self.sorter);
//    } else {
//      // NOTE: using anchor node to set the text color/style the same as other
//      // cells
//      // label = document.createTextNode(column.get("label"));
//      label = $("<a>" + column.get("label") +"</a>");
//    }
//    this.$el.append(label);
//    this.$el.addClass(column.get("direction"));
//    this.$el.addClass(column.get("name"));
//    this.delegateEvents();
//
//    var mouseover = this.options['column']['attributes']["description"];
//    if (this.options['column'].has('mouseover')){
//      mouseover = this.options['column'].get('mouseover');
//    }
//    this.$el.prop('title', mouseover);
//
//    return this;
//  }

}); // end MultiSortHeaderCell

var FilterHeaderCell = Iccbl.FilterHeaderCell = Iccbl.MultiSortHeaderCell.extend({

  filtericon_text : '<span class="pull-left glyphicon glyphicon-search" ' +
    ' id="filter-icon" ></span>',
  expandicon_text : '<span ' +
    ' class="pull-left glyphicon glyphicon-chevron-down" ' +
    ' id="expand-filter-icon" > ' +
    ' <span id="expand-filter-icon-text" ></span></span>',
  collapseicon_text : '<span ' +
    ' class="pull-left glyphicon glyphicon-chevron-up"'+
    ' id="collapse-filter-icon" ></span>',

  initialize : function(options) {
    var self = this;
    FilterHeaderCell.__super__.initialize.apply(this, arguments);

    this.filterIcon = $(this.filtericon_text);
    this.collapseIcon = $(this.collapseicon_text);
    this.expandIcon = $(this.expandicon_text);
    this.expandIconText = this.expandIcon.find('#expand-filter-icon-text');

    this.fieldinformation = options.fieldinformation || this.fieldinformation;
    if (_.isUndefined(this.fieldinformation)){
      throw 'must define a fieldinformation for FilterHeaderCell';
    }
    this.serverSideFilter = options.serverSideFilter || this.serverSideFilter;
    if (_.isUndefined(this.serverSideFilter)){
      throw 'must define a serverSideFilter for FilterHeaderCell';
    }

    this._serverSideFilter = new this.serverSideFilter(_.extend({
      columnName: this.column.get('name'),
      fieldinformation: this.fieldinformation
    }, options));

    this.listenTo(this.collection,"MyServerSideFilter:search",this._search);
    this.listenTo(this.collection,"Iccbl:clearSearches",this.clearSearch);

    _.bindAll(this, '_submit', 'clearSearch');
  },

  /**
   * Listen for router generated search events
   */
  _search: function(hash, collection){
    var self = this;
    var name = this.column.get('name');
    var searchHash = _.clone(hash);

    // TODO: could use form.isSet() instead of found
    var found = this._serverSideFilter._search(searchHash);

    if(found){
      self.$el.addClass('filtered');
      self.expandIconText.html(
        self._serverSideFilter._printSearchHash(
          self._serverSideFilter._getSearchHash()));
    }else{
      self.$el.removeClass('filtered');
      self.expandIconText.empty();
    }
  },

  clearSearch: function(options){
    var self=this;
    var name = this.column.get('name');

    if (_.result(options,'fields_to_clear')){
      if (!_.contains(options.fields_to_clear, name)){
        return;
      }
    }

    self._serverSideFilter.clear();
    self._serverSideFilter.$el.hide();
    self.filterIcon.show();
    self.collapseIcon.hide();
    self.expandIconText.empty();
    self.expandIcon.hide();
  },

  _submit: function(e){
    var self  = this;
    if (e) e.preventDefault();

    var searchHash = self._serverSideFilter._submit();
    if(!_.isEmpty(searchHash)){
      var possibleSearches = self._serverSideFilter.getPossibleSearches();
      self.collection.clearSearch(possibleSearches, {silent: true});

      if (Iccbl.appModel.DEBUG){
        console.log('server side filter add search: ' +
            JSON.stringify(searchHash));
      }
      this.collection.addSearch(searchHash,{reset: true});
    }else{
      console.log('nothing submitted');
    }
  },

  _collapse: function(){
    this._serverSideFilter.$el.hide();
    this.$el.removeClass('expanded');
  },

  _expand: function(){
    this._serverSideFilter.$el.show();
    this.$el.addClass('expanded');
  },

  render : function() {
    var self = this;
    FilterHeaderCell.__super__.render.apply(this);
    // 20181115 - this breaks layout for custom tables with no sorting at all:
    // because no headers are two rows
//    if (_.result(this.fieldinformation,'filtering') !== true){
//      // If not filtering, adjust so that title lines up with other header cells
//      console.log('non-filtering cell', this.column.get('name'));
//      this.$el.find('a').css({
//        'position': 'relative',
//        'bottom': '1em'
//      });
//      return this;
//    }
    if (_.result(this.fieldinformation,'filtering') !== true){
      return this;
    }

    this._serverSideFilter.render();
    this.$el.append(this._serverSideFilter.el);
    this._serverSideFilter.$el.hide();
    this.$el.append(this.filterIcon);
    this.$el.append(this.collapseIcon);
    this.$el.append(this.expandIcon);

    this._serverSideFilter.clearButton().click(function(e){
      e.preventDefault();
      e.stopPropagation();
      self.clearSearch();

      var possibleSearches = self._serverSideFilter.getPossibleSearches();
      self.collection.clearSearch(possibleSearches);
    });

    this._serverSideFilter.submitButton().click(function(e){
      e.preventDefault();
      self._submit();
      self._collapse();
    });

    this.filterIcon.click(function(e){
      self._expand();
      return false;
    });

    this.collapseIcon.click(function(e){
      self._collapse();
      return false;
    });

    this.expandIcon.click(function(e){
      self._expand();
      return false;
    });
    return this;
  },

}); // end FilterHeaderCell

///// Header Cell Filters /////

var BackgridFormFilter = Backbone.Form.extend({

  template: _.template([
    "<form class='form-horizontal container' >",
    '<div class="row center-block" style="margin: 0 0 0 0;" >',
    "<div data-fieldsets   />",
    "</div>",
    "</form>"].join('')),
   checkboxTemplate: _.template([
      '<div class="form-group" style="margin-bottom: 0px;" >',
      '    <div class="checkbox" style="text-align: left; min-height: 0px; padding-top: 0px;" > ',
      '      <label for="<%= editorId %>"><div><span data-editor\></div><%= title %></label>',
      '    </div>',
      '  </div>'
      ].join('')),

  initialize : function(options) {
    BackgridFormFilter.__super__.initialize.apply(this, arguments);
    var self = this;

    this.fieldinformation = options.fieldinformation || this.fieldinformation;
    if (_.isUndefined(this.fieldinformation)){
      throw 'must define a fieldinformation for header cell BackgridFormFilter';
    }

    this.columnName = options.columnName || this.columnName;
    if (_.isUndefined(this.columnName)){
      throw 'must define a columnName member for header cell BackgridFormFilter';
    }

  },

  _printSearchHash: function(searchHash){
    var self = this;
    function lookupOperator(operator){
      var lookup = {
        gt: '>',
        lt: '<',
        gte: '>=',
        lte: '<=',
        eq: '=',
        in: ''
      };
      return _.result(lookup, operator, operator);
    }
    function lookupVal(val){
      // If there is a criterium, use the readable val
      val = _.result(self.criterium, val, val);
      // If there is a choiceHash, use the readable val
      val = _.result(self.choiceHash, val, val);
      return val;
    }
    return '&nbsp;' + _.map(
      _.pairs(searchHash),
      function(pair){
        var key_operator = pair[0].split('__');
        var val = '' + pair[1];
        val = lookupVal(val);
        var operator = '='
        if (key_operator.length == 2){
          operator = key_operator[1];
          operator = lookupOperator(operator);
        }
        if (operator == 'range'){
          val = val.split(",").join('-');
        } else {
          val = _.map(val.split(","),lookupVal).join(', ');
        }
        if (key_operator[0].charAt(0)=='-'){
          operator = 'not ' + operator;
        }
        return operator + '&nbsp;' + val;
      }).join('&');
  },

  _getSearchHash: function(){
    throw '_getSearchHash must be implemented';
  },

  _search: function(){
    throw '_search must be implemented';
  },

  clearSearch: function(){
    throw 'clearSearch must be implemented';
  },

  _submit: function(){
    throw '_submit must be implemented';
  },
  isSet: function(){
    throw 'isSet must be implemented';
  },

  /**
   * - add a submit button
   * - add a clear button
   */
  render: function () {
    var self = this;
    BackgridFormFilter.__super__.render.apply(this, arguments);

    this.$el.append([
      '<div id="form-last-row" class="iccbl-headerfield-form-last-row" >',
      '<div class="col-xs-6">',
      '<button type="submit" class="btn btn-default btn-block" > Ok </input>',
      '</div>',
      '<div class="col-xs-6">',
      '<a class="backgrid-filter clear close" data-backgrid-action="clear"',
      ' href="#">&times;</a>',
      '</div>',
      '</div>'
      ].join(''));

    return this;
  },

  clearButton: function(){
    return this.$el.find("a[data-backgrid-action=clear]");
  },

  submitButton: function(){
    return this.$el.find(':submit');
  },

  /**
   * Override the Backbone Layoutmanager template rendering to use Backbone
   * Forms
   */
  renderTemplate: function() {
    return Backbone.Form.prototype.render.apply(this);
  },

  templateData: function() {
    return { years: 0, months: 0, dates: 0 };
  }


});


var CriteriumFormFilter = Iccbl.CriteriumFormFilter = BackgridFormFilter.extend({
  criterium: {'=':'eq'},
  errorClass: 'has-error',
  criteriaTemplate:
    [
      '<span  data-editor ></span>'
    ].join(''),
  fieldTemplate: [
      '<div data-editor title="<%= help %>" class="" >',
    ].join(''),

  getPossibleSearches: function(){
    var self = this;
    var name = self.columnName;
    var possibleSearches = [];
    _.each(_.values(self.criterium), function(criteria){
      possibleSearches.push(name + '__' + criteria);
      possibleSearches.push('-'+name + '__' + criteria);
    });
    return possibleSearches;
  },

  //  /**
  //   * Determine if the form has been set with any values.
  //   */
  //  isSet: function(){
  //    var values = this.getValue();
  //    if (_.isEmpty(values['lower_criteria'])){
  //      return false;
  //    }
  //    var found = _.find(_.keys(values), function(key){
  //      if(key == 'lower_criteria' ){
  //        if(values[key] == 'blank' || values[key] == 'not blank') return true;
  //        return false;
  //      }
  //      // signal isSet for any field value set
  //      return values[key]>0 || !_.isEmpty(values[key]);
  //    });
  //    return !_.isEmpty(found);
  //  },

  clear: function(){
    var self = this;
    _.each(_.keys(self.getValue()), function(key){
      self.setValue(key, null);
    });
  }

});

var TextFormFilter = CriteriumFormFilter.extend({

  criterium: {'=':'eq','contains':'contains','icontains':'icontains','<>':'ne',
    'in': 'in','blank':'is_blank','not blank':'not_blank'},

  // provide a custom form template; use Bootstrap layout/styling
  template: _.template([
      '<form class="iccbl-headerfield-form" >',
      '<div class="row center-block" style="margin: 0 0 0 0;" >',
      "<div class='col-xs-12' >",
      '   <div data-fields="lower_criteria" ',
      '     class="iccbl-headerfield-text" for="lower_value"   />',
      '<div class="form-group" data-fields="form_textarea" />',
      '<div class=""  data-fields="invert_field" />',
      '</div>',
      '</div>',
      '</form>'
    ].join('')),

  initialize : function(options) {
    var self = this;
    var options = this.options = options || {};

    var formSchema = this.schema = {};
    formSchema['lower_criteria'] = {
        title: '',
        key:  'lower_criteria', // TODO: "key" not needed>?
        type: 'Select',
        options: _.keys(self.criterium),
        template: _.template(self.criteriaTemplate),
        editorClass: 'form-control'
    };
    formSchema['form_textarea'] = {
        title: '',
        help: 'enter a comma separated list',
        key: 'form_textarea',
        type: 'TextArea',
        template: _.template(self.fieldTemplate),
        editorClass: 'form-control'
    };
    formSchema['invert_field'] = {
        title: 'Exclude',
        help: 'Select this to exclude the criteria',
        type: 'Checkbox',
        template: self.checkboxTemplate,
        editorClass: ''
    };

    var FormFields = Backbone.Model.extend({
      schema: formSchema,
      validate: function(attrs) {
        var errs = {};
        if(!_.isEmpty(errs)) return errs;
      }
    });
    this.model = new FormFields();
    this.model.set('lower_criteria','='); // default

    // Set BackboneForms selectedFields variable:
    // Check which fields will be included (defaults to all)
    this.selectedFields = ['lower_criteria','form_textarea','invert_field'];

    TextFormFilter.__super__.initialize.apply(this, arguments);

    this.listenTo(this, "change", function(e){
      var criteria = self.getValue('lower_criteria');
      if(criteria == 'blank' || criteria == 'not blank'){
        self.$el.find('[data-fields="form_textarea"]').hide();
      }else{
        self.$el.find('[data-fields="form_textarea"]').show();
      }
    });
  },

  isSet: function(){
    var values = this.getValue();
    if (_.isEmpty(values['lower_criteria'])){
      return false;
    }
    var found = _.find(_.keys(values), function(key){
      if(key == 'lower_criteria' ){
        if(values[key] == 'blank' || values[key] == 'not blank') return true;
        return false;
      }
      // signal isSet for any field value set
      return values[key]>0 || !_.isEmpty(values[key]);
    });
    return !_.isEmpty(found);
  },

  _search: function(hash){
    var self = this;
    var searchHash = _.clone(hash);

    var found = false;
    _.each(_.keys(self.criterium), function(criteriaKey){

      var criteria = self.criterium[criteriaKey];
      var searchTerm = self.columnName + '__' + criteria;
      var nsearchTerm = '-' + self.columnName + '__' + criteria;

      var searchVal = null;
      var negated = false;
      if(_.has(searchHash, searchTerm)){
        searchVal = searchHash[searchTerm];
      }else if(_.has(searchHash, nsearchTerm)){
        searchVal = searchHash[nsearchTerm];
        negated=true;
      }else if (_.has(searchHash,self.columnName)){
        searchVal = searchHash[self.columnName];
        criteria = 'eq';
        searchTerm = self.columnName + '__' + criteria;
        delete searchHash[self.columnName]
        searchHash[searchTerm] = searchVal;
      }else if (criteria == 'is_blank'){
        searchTerm = self.columnName + '__is_null';
        nsearchTerm = '-' + self.columnName + '__is_null';
        searchVal = _.result(
          searchHash,searchTerm, _.result(searchHash,nsearchTerm, null));
      }
      if(searchVal !== null){
        found = true;
        self.setValue('lower_criteria', criteriaKey);
        if(criteria == 'is_blank'){
          self.$el.find('[data-fields="form_textarea"]').hide();
          if(searchVal == false || searchVal == 'false'){
            self.setValue('lower_criteria', 'not blank');
          }
        }else{
          self.$el.find('[data-fields="form_textarea"]').show();
          self.setValue('form_textarea', searchVal);
        }
        if(negated){
          self.setValue('invert_field', true);
        }
      }
    });
    return found;
  },

  _getSearchHash: function(){
    var self = this;

    var searchHash = {};
    var values = self.getValue();
    var criteria = self.criterium[values['lower_criteria']];
    var searchKey = self.columnName + '__' + criteria;
    var searchVal = values['form_textarea'];
    if (criteria == 'not_blank'){
      searchKey = self.columnName + '__' + 'is_blank';
      searchVal = 'false'
    } else if (criteria == 'is_blank'){
      searchVal = 'true';
    } else if (criteria == 'in' && searchVal){
      searchVal = searchVal.split( /\s*[,\n]\s*/);
    }
    var invert = values['invert_field'];
    if(invert) searchKey = '-'+searchKey;
    searchHash[searchKey] = searchVal;

    return searchHash;

  },

  _submit: function(){
    var self = this;
    if(!self.isSet()) return;
    var self  = this;
    var searchHash = {};
    var errors = self.commit({ validate: true });
    if(!_.isEmpty(errors)){
      console.log('form errors, abort submit: ' + JSON.stringify(errors));
      return;
    }else{
      // this.$el.find('#range_upper_block').removeClass(self.errorClass);
    }

    return self._getSearchHash();
  },

  getPossibleSearches: function(){
    var possibleSearches =
      CriteriumFormFilter.prototype.getPossibleSearches.apply(this,arguments);
    // TODO: add in the "=" (without __eq)
    possibleSearches.push(this.columnName)
    return possibleSearches;
  }

});

var DateEditor = Backbone.Form.editors.Date.extend({

  /**
   * need to extend because an error in the bbf initializer makes it impossible
   * to override the monthnames otherwise. (Using var Self = Form.editors.Date;
   * this.options = _.extend({ monthNames: Self.monthNames, why?
   */
  monthNames: [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct',
    'Nov', 'Dec'],

  initialize : function(options) {
    var self = this;
    DateEditor.__super__.initialize.apply(this, arguments);
    // now override monthnames
    self.options.monthNames = self.monthNames;
  },
});

var DateFormFilter = CriteriumFormFilter.extend({

  criterium: {'': 'unset', '=':'eq','>':'gt','>=':'gte','<':'lt','<=':'lte','<>':'ne',
    'between':'range', 'in': 'in','blank':'is_null','not blank':'not_blank'},

  template: _.template([
      '<form class="iccbl-headerfield-form" >',
      '<div class="row center-block" style="margin: 0 0 0 0;" >',
      '   <div data-fields="lower_criteria" ',
      '     class="form-control" for="lower_value"   />',
      '   <div class="input-group pull-right"  data-fields="lower_value"/>',
      '<div class="row center-block" style="margin: 0 0 0 0;" >',
      '   <div class="form-group" data-fields="form_textarea" style="display: none;" />',
      '</div>',
      '<div class="row center-block" style="margin: 0 0 0 0;" >',
      '   <div class="input-group" id="range_upper_block" style="display: none;" >',
      '     <span class="input-group-addon" for="upper_value"  style="width: 4em; ">and</span>',
      '     <span data-fields="upper_value"/>',
      '   </div>',
      '</div>',
      '   <div class=""  data-fields="invert_field" />',
      '</div>',
      '</form>'
    ].join('')),

  initialize : function(options) {
    var self = this;

    var options = this.options = options || {};
    var formSchema = this.schema = {};
    formSchema['lower_criteria'] = {
        title: '',
        key:  'lower_criteria', // TODO: "key" not needed>?
        type: 'Select',
        options: _.keys(self.criterium),
        template: _.template(self.criteriaTemplate),
        editorClass: 'form-control'
    };
    formSchema['lower_value'] = {
        title: '',
        key: 'lower_value',
        type: DateEditor,
        template: _.template(self.fieldTemplate),
        editorClass: 'form-control',
        monthNames: self.monthNames

    };
    formSchema['form_textarea'] = {
        title: '',
        help: 'enter a comma separated list',
        key: 'form_textarea',
        type: 'TextArea',
        template: _.template(self.fieldTemplate),
        editorClass: 'form-control'
    };
    formSchema['upper_value'] = {
        title: '',
        key: 'upper_value',
        type: DateEditor,
        template: _.template(self.fieldTemplate),
        editorClass: 'form-control',
        monthNames: self.monthNames
    };
    formSchema['invert_field'] = {
        title: 'Exclude',
        help: 'Select this to exclude the criteria',
        type: 'Checkbox',
        template: self.checkboxTemplate,
        editorClass: ''
    };

    var FormFields = Backbone.Model.extend({
      schema: formSchema,
      validate: function(attrs) {
        var errs = {};
        if(attrs.lower_criteria == 'in'
          && !_.isEmpty(attrs.form_textarea) ){
          var datevals = attrs.form_textarea.split(',');
          var errmsgs = [];
          _.each(datevals, function(dateval){
            try{
              var v = new Date(dateval)
            }catch(e){
              errmsgs.push('not a date: '+dateval + ', err: ' + e);
            }
          })
        }
        if(!_.isEmpty(errmsgs)){
          errs['form_textarea'] = errmsgs;
          return errs;
        }
      }
    });
    this.model = new FormFields();
    this.model.set('lower_criteria','='); // default

    // Set BackboneForms selectedFields variable:
    // Check which fields will be included (defaults to all)
    this.selectedFields = ['lower_criteria','lower_value','form_textarea',
                           'upper_value','invert_field'];

    this.listenTo(this, "change", function(e){
      var criteria = self.getValue('lower_criteria');
      if (Iccbl.appModel.DEBUG) console.log('change:' + criteria)
      if(criteria == 'between'){
        self.$el.find('[data-fields="lower_value"]')
          .find('input').prop('disabled', false);
        self.$el.find('[data-fields="form_textarea"]').hide();
        self.$el.find('#range_upper_block').show();
      }else if(criteria == 'in'){
        self.$el.find('[data-fields="lower_value"]')
          .find('input').prop('disabled', true);
        self.setValue('lower_value', '');
        self.$el.find('#range_upper_block').hide();
        self.$el.find('[data-fields="form_textarea"]').show();
      }else{
        self.$el.find('[data-fields="lower_value"]')
          .find('input').prop('disabled', false);
        self.$el.find('[data-fields="form_textarea"]').hide();
        self.$el.find('#range_upper_block').hide();
      }
    });

    DateFormFilter.__super__.initialize.apply(this, arguments);

  },

  clear: function(){
    this.model.set('lower_criteria',null);
  },

  isSet: function(){
    var values = this.getValue();
    if (_.isEmpty(values['lower_criteria'])){
      return false;
    }
    var found = _.find(_.keys(values), function(key){
      return values[key] !== '';
    });
    return !_.isEmpty(found);
  },

  _search: function(hash){
    var self = this;
    var searchHash = _.clone(hash);

    var found = false;
    _.each(_.keys(self.criterium), function(criteriaKey){
      var criteria = self.criterium[criteriaKey];
      var searchTerm = self.columnName + '__' + criteria;
      var nsearchTerm = '-' + self.columnName + '__' + criteria;
      var searchVal = null;
      var negated = false;
      if(_.has(searchHash, searchTerm)){
        var searchVal = searchHash[searchTerm];
      }else if(_.has(searchHash, nsearchTerm)){
        var searchVal = searchHash[nsearchTerm];
        negated=true;
      }
      if(searchVal !== null){
        found = true;
        self.setValue('lower_criteria', criteriaKey);
        try{
          if(criteria == 'range'){
            self.$el.find('#range_upper_block').show();
            var vals = searchVal.split(',');
            if(vals.length < 2){
              throw "the range filter requires 2 date arguments separated by " +
              "a comma, given: " + searchVal
            }
            self.setValue('lower_value', new Date(vals[0]));
            self.setValue('upper_value', new Date(vals[1]));
          }else if(criteria == 'in'){
            self.$el.find('[data-fields="lower_value"]')
              .find('input').prop('disabled', true);
            self.setValue('lower_value', '');
            self.$el.find('[data-fields="form_textarea"]').show();
            self.setValue('form_textarea', searchVal);
          }else if(criteria == 'is_null'){
            if(searchVal == false || searchVal == 'false'){
              self.setValue('lower_criteria', 'not blank');
            }
          }else{
            self.setValue('lower_value', new Date(searchVal));
          }
        }catch(e){
          var msg = 'Unable to parse date portion of the url, column: ' +
              self.columnName +', searchVal:'+ searchVal + ', error: ' + e;
          console.log(msg);
          Iccbl.appModel.error(msg);
          return false;
        }

        if(negated){
          self.setValue('invert_field', true);
        }
      }
    });
    return found;
  },

  _getSearchHash: function(){
    var self = this;
    var searchHash = {};
    var values = self.getValue();
    var name = self.columnName;


    var invert = values['invert_field'];
    if(invert) name = '-'+name;
    var criteria = self.criterium[values['lower_criteria']];
    var searchKey = name + '__' + criteria;

    if(criteria == 'in'){
      searchHash[searchKey] = values['form_textarea'];
    }else if(criteria == 'is_null'){
      searchHash[searchKey] = 'true';
    }else if(criteria == 'not_blank'){
      var searchKey = name + '__is_null';
      searchHash[searchKey] = 'false';
    }else if(_.isDate(values['lower_value']) ){
      if(criteria == 'range'){
        if(_.isDate(values['upper_value'])){
          var searchKey = name + '__' + criteria;
          searchHash[searchKey] = values['lower_value'].toISOString()
              + ',' + values['upper_value'].toISOString();
        }else{
          console.log('upper value not set; validation should have caught this');
        }
      }else{
        searchHash[searchKey] = values['lower_value'].toISOString();
      }
    }
    return searchHash

  },

  _submit: function(){
    var self  = this;
    if(!self.isSet()) return;

    // validate:true: tells bbf to run model.validate(), in addition to
    // field[].validate()
    var errors = self.commit({ validate: true });
    if(!_.isEmpty(errors)){
      console.log('form errors, abort submit: ' + JSON.stringify(errors));
      this.$el.find('#range_upper_block').addClass(self.errorClass);
      return;
    }else{
      this.$el.find('#range_upper_block').removeClass(self.errorClass);
    }

    return self._getSearchHash();
  }
});

var BooleanFormFilter = CriteriumFormFilter.extend({
  criterium: {'': '', 'true': 'True', 'false': 'False',
    'blank':'is_null','not blank':'not_blank'},

  template: _.template([
      '<form class="iccbl-headerfield-form" >',
      '<div class="row center-block" style="margin: 0 0 0 0;" >',
      "<div class='col-xs-12' >",
      '   <div data-fields="lower_criteria" ',
      '     class="iccbl-headerfield-text" for="lower_value"   />',
      "</div>",
      "</form>"].join('')),

  initialize : function(options) {
    var self = this;
    var options = this.options = options || {};
    var formSchema = this.schema = {};
    
    var _options = [];
    _.each(_.keys(self.criterium), function(key){
      _options.push({ val: key, label: self.criterium[key] });
    })
    
    formSchema['lower_criteria'] = {
        title: '',
        key:  'lower_criteria', // TODO: "key" not needed>?
        type: 'Select',
        options: _options,
        template: _.template(self.criteriaTemplate),
        editorClass: 'form-control'
    };

    var FormFields = Backbone.Model.extend({
      schema: formSchema,
      validate: function(attrs) {
        var errs = {};
        if(!_.isEmpty(errs)) return errs;
      }
    });
    this.model = new FormFields();

    // Set BackboneForms selectedFields variable:
    // Check which fields will be included (defaults to all)
    this.selectedFields = ['lower_criteria']

    BooleanFormFilter.__super__.initialize.apply(this, arguments);
  },

  _getSearchHash: function(){
    var self = this;
    var searchHash = {};
    var values = self.getValue();
    var name = self.columnName;

    var criteria = self.criterium[values['lower_criteria']];
    if(criteria == 'not_blank'){
      searchKey = name + '__' + 'is_null';
      searchHash[searchKey]='false';
    }else if(criteria == 'is_null'){
      searchKey = name + '__' + 'is_null';
      searchHash[searchKey]='true';
    }else if(criteria == 'False'){
      searchKey = name + '__eq';
      searchHash[searchKey]='false';
    }else if(criteria == 'True'){
      searchKey = name + '__eq';
      searchHash[searchKey]='true';
    }
    return searchHash;
  },

  _submit: function(){
    var self  = this;
    if(!self.isSet()) return;

    return self._getSearchHash();
  },

  _search: function(hash){
    var self = this;
    var searchHash = _.clone(hash);

    var searchTerm = null;
    _.each(self.getPossibleSearches(), function(term){
      if(_.has(searchHash,term)) searchTerm = term;
    });
    var searchVal = searchHash[searchTerm];
    var name = this.columnName;
    if(searchTerm){
      if(searchTerm ==  name + '__is_null'){
        if(searchVal == 'true'){
          self.setValue('lower_criteria','blank');
        }else{
          self.setValue('lower_criteria', 'not blank');
        }
      }else if(searchTerm ==  name + '__eq'){
        if(searchVal == 'true'){
          self.setValue('lower_criteria','true');
        }else{
          self.setValue('lower_criteria', 'false');
        }
      }
    }
    return searchTerm;
  },

  isSet: function(){
    var values = this.getValue();
    var found = _.find(_.keys(values), function(key){
      return values[key];
    });
    return found;
  },

  getPossibleSearches: function(){
    return [this.columnName + '__eq',
            this.columnName + '__is_null'];
  }

});

var SelectorFormFilter = CriteriumFormFilter.extend({

  criterium: {'': 'unset', 'blank':'is_null','not blank':'not_blank'},

  template: _.template([
      "<form  class='form-horizontal container ' >",
      '<div class="row center-block" style="margin: 0 0 0 0;" >',
      "<div data-fieldsets   />",
      "</div>",
      "</form>"].join('')),

   altFieldTemplate: _.template([
      '<div class="form-group" id="form-group-<%= key %>" style="margin-bottom: 0px;" >',
      '    <div class="checkbox" style="text-align: left; ',
      '       min-height: 0px; padding-top: 0px;" > ',
      '      <label for="<%= editorId %>">',
      '      <div><span data-editor\></div><%= title %></label>',
      '    </div>',
      '  </div>'
      ].join('')),

  initialize: function(options){

    var self = this;
    this.fieldinformation = options.fieldinformation || this.fieldinformation;
    if (_.isUndefined(this.fieldinformation)){
      throw 'must define a fieldinformation for SelectorFormFilter';
    }

    // Create a form of checkboxes, one for each vocabulary item:
    // 1. start with fieldinformation.choices
    // 2. override with fieldinformation.vocabulary:
    // 2.a from fieldinformation.vocabulary, if available
    // 2.b fetch and add vocabulary from server

    this.retiredFields = [];
    var choiceHash = this.choiceHash = {};
    var vocabulary;
    if(!_.isEmpty(this.fieldinformation.vocabulary)){
      // TODO: vocabulary is using the titles as the key,
      // because of how Backgrid.SelectCell initializes
      _.each(this.fieldinformation.vocabulary,function(pair){
        choiceHash[pair[1]] = pair[0];
      });
    }else{
      try{
        vocabulary = Iccbl.appModel.getVocabulary(
          this.fieldinformation.vocabulary_scope_ref);
        if (Iccbl.appModel.DEBUG){
          console.log('got vocab', this.fieldinformation.vocabulary_scope_ref, vocabulary);
        }
        _.each(_.keys(vocabulary),function(choice){
          if (vocabulary[choice].is_retired === true){
            self.retiredFields.push(choice);
          }
          choiceHash[choice] = vocabulary[choice].title;
        });
      }catch(e){
        console.log(
          'vocabulary error', this.fieldinformation.key,
          this.fieldinformation.vocabulary_scope_ref);
      }
    }

    var formSchema = this.schema = {};
    _.each(_.keys(choiceHash), function(choice){
      formSchema[choice] = {
          title: choiceHash[choice],
          key:  choice,
          type: 'Checkbox',
          template: self.altFieldTemplate
      };
      if (_.contains(self.retiredFields, choice)){
        formSchema[choice].title = formSchema[choice].title + ' (r)';
      }

    });

    formSchema['lower_criteria'] = {
      title: '',
      key:  'lower_criteria', // TODO: "key" not needed>?
      type: 'Select',
      options: _.keys(self.criterium),
      template: _.template(self.criteriaTemplate),
      editorClass: 'form-control'
    };

    formSchema['invert_field'] = {
        title: 'Exclude',
        help: 'Select this to exclude the criteria',
        type: 'Checkbox',
        template: self.checkboxTemplate,
        editorClass: ''
    };

    if (!_.isEmpty(this.retiredFields)){
      formSchema['show_retired'] = {
          title: 'show retired vocabularies',
          help: 'show the retired vocabularies',
          type: 'Checkbox',
          template: self.checkboxTemplate,
          editorClass: ''
      };
    }

    var FormFields = Backbone.Model.extend({
      schema: formSchema
    });
    this.model = new FormFields();

    SelectorFormFilter.__super__.initialize.apply(this, arguments );

    this.listenTo(this, "show_retired:change", function(){

      var show_retired = self.getValue('show_retired');
      if (show_retired === true){
        _.each(self.retiredFields, function(key){
          self.$el.find('[data-fields]').find('#form-group-'+ key).show();
        });
      } else {
        _.each(self.retiredFields, function(key){
          self.$el.find('[data-fields]').find('#form-group-'+ key).hide();
        });
      }
    });

    this.listenTo(this, "lower_criteria:change", function(){
      var criteria = self.getValue('lower_criteria');
      if (Iccbl.appModel.DEBUG) console.log('criteria: ' + criteria);
      if(criteria == 'blank'){
        self.$el.find('[data-fields]').find('input').prop('disabled', true);
      }else if(criteria == 'not blank'){
        self.$el.find('[data-fields]').find('input').prop('disabled', true);
      }else {
        self.$el.find('[data-fields]').find('input').prop('disabled', false);
      }
    });

  },

  clear: function(){
    SelectorFormFilter.__super__.clear.apply(this, arguments);
    this.$el.find('[data-fields]').find('input').prop('disabled', false);
  },

  _getSearchHash: function(){
    var self = this;
    var searchHash = {};
    var values = self.getValue();
    var name = self.columnName;

    var invert = values['invert_field'];
    if(invert) name = '-'+name;

    var criteria = self.criterium[values['lower_criteria']];
    var searchKey = name + '__' + criteria;
    if(criteria == 'not_blank'){
      searchKey = name + '__' + 'is_null';
      searchVal = 'false';
      searchHash[searchKey]=searchVal;
    }else if(criteria == 'is_null'){
      searchVal = 'true';
      searchHash[searchKey]=searchVal;
    }else{
      var selected = _.filter(_.keys(values), function(key){
        if(key !== 'invert_field' && key !== 'show_retired') return values[key];
        return false;
      });
      searchHash[name +'__in'] = selected.join(',');
    }

    return searchHash;
  },

  _submit: function(){
    var self  = this;
    if(!self.isSet()) return;

    return self._getSearchHash();
  },

  _search: function(hash){
    var self = this;
    var searchHash = _.clone(hash);
    var searchTerm = null;
    var name = this.columnName;
    var searchVal = null;

    _.each(self.getPossibleSearches(), function(term){
      if(_.has(searchHash,term)){
        searchTerm = term;
        searchVal = searchHash[term];
      }
    });

    if(searchTerm){
      if(searchTerm.charAt(0) == '-'){
        self.setValue('invert_field', true);
        name = '-' + name;
      }
      if(searchTerm ==  name + '__is_null'){
        if(searchVal == 'true' || searchVal == true){
          self.setValue('lower_criteria','blank');
        }else{
          self.setValue('lower_criteria', 'not blank');
        }
      }else{
        var searchVal = searchHash[searchTerm];
        if (!_.isArray(searchVal)){
          searchVal = searchVal.split(',');
        }
        _.each(searchVal, function(choice){
          self.setValue(choice, true);
        });
      }
    }
    return searchTerm;
  },

  /**
   * SelectorFormFilter Convenience - determine if the form has been set with
   * any values
   */
  isSet: function(){
    var values = this.getValue();
    var found = _.find(_.keys(values), function(key){
      if(key == 'invert_field' ) return false; // skip invert field
      return values[key];
    });
    return found;
  },

  getPossibleSearches: function(){
    var possibleSearches = [this.columnName + '__in', '-'+this.columnName + '__in',
            this.columnName + '__is_null'];
    possibleSearches.push(this.columnName)
    return possibleSearches;
  },

  render: function(){
    var self = this;
    var el = SelectorFormFilter.__super__.render.apply(this, arguments);
    _.each(self.retiredFields, function(key){
      self.$el.find('[data-fields]').find('#form-group-'+ key).hide();
    });
    return this;
  }
});

var NumberFormFilter = CriteriumFormFilter.extend({

  criterium: {
    '=':'eq','\u2248':'about','>':'gt', '>=':'gte','<':'lt','<=':'lte',
    '<>':'ne', 'x..y':'range', 'in': 'in','blank':'is_null',
    'not blank':'not_blank'
  },

  // FIXME: this template is a mix of adaptive and fixed styles, for instance:
  // for the first input-group: style="width: 50px"
  template: _.template([
      '<form class="iccbl-headerfield-form" >',
      '<div class="center-block" style="margin: 0 0 0 0;" >',
      '<div class="input-group" style="width: 50px" >',
      '   <div data-fields="lower_criteria" ',
      '     class="input-group-addon iccbl-headerfield-number" for="lower_value"   />',
      '   <div data-fields="lower_value"/>',
      '</div>',
      '<div class="form-group" data-fields="form_textarea" style="display: none;" />',
      '<div class="input-group" id="range_upper_block" style="display: none;" >',
      '   <span class="input-group-addon" for="upper_value" style="width: 4em; ">to</span>',
      '   <span data-fields="upper_value"/>',
      '</div>',
      '<div class=""  data-fields="invert_field" />',
      '</div>',
      '</form>'
    ].join('')),

  initialize : function(options) {
    var self = this;
    var options = this.options = options || {};
    var formSchema = options.schema = options.schema || {};
    var fields = options.fields = options.fields || [];

    formSchema['lower_criteria'] = {
        title: '',
        key:  'lower_criteria',
        type: 'Select',
        options: _.keys(self.criterium),
        template: _.template(self.criteriaTemplate),
        editorClass: 'form-control'
    };
    formSchema['lower_value'] = {
        title: '',
        key: 'lower_value',
        type: 'Number',
        template: _.template(self.fieldTemplate),
        editorClass: 'form-control'
    };
    formSchema['form_textarea'] = {
        title: '',
        help: 'enter a comma separated list',
        key: 'form_textarea',
        type: 'TextArea',
        template: _.template(self.fieldTemplate),
        editorClass: 'form-control'
    };
    formSchema['upper_value'] = {
        title: '',
        key: 'upper_value',
        type: 'Number',
        template: _.template(self.fieldTemplate),
        editorClass: 'form-control '
    };
    formSchema['invert_field'] = {
        title: 'Exclude',
        help: 'Select this to exclude the criteria',
        type: 'Checkbox',
        template: self.checkboxTemplate,
        editorClass: ''
    };

    var FormFields = Backbone.Model.extend({
      validate: function(attrs) {
        var errs = {};
        //        if(attrs.lower_criteria == '...'
        //          && ( attrs.upper_value < 1 ) ){
        //          errs['upper_value'] = '!'
        //        }
        if(!_.isEmpty(errs)) return errs;
      }
    });
    this.model = options['model'] = new FormFields();
    this.model.set('lower_criteria','>'); // default

    options.fields = fields.concat(
        ['lower_criteria','lower_value','form_textarea',
         'upper_value','invert_field']);

    this.listenTo(this, "change", function(e){
      var criteria = self.getValue('lower_criteria');
      if(criteria == 'x..y'){
        self.$el.find('[data-fields="lower_value"]')
          .find('input').prop('disabled', false);
        self.$el.find('[data-fields="form_textarea"]').hide();
        self.$el.find('#range_upper_block').show();
      }else if(criteria == 'in'){
        self.$el.find('[data-fields="lower_value"]')
          .find('input').prop('disabled', true);
        self.setValue('lower_value', '');
        self.$el.find('#range_upper_block').hide();
        self.$el.find('[data-fields="form_textarea"]').show();
      }else{
        self.$el.find('[data-fields="lower_value"]')
          .find('input').prop('disabled', false);
        self.$el.find('[data-fields="form_textarea"]').hide();
        self.$el.find('#range_upper_block').hide();
      }
    });

    NumberFormFilter.__super__.initialize.call(this, options);

  },

  isSet: function(){
    var values = this.getValue();
    if (_.isEmpty(values['lower_criteria'])){
      return false;
    }
    var found = _.find(_.keys(values), function(key){
      return values[key] !== '';
    });
    return !_.isEmpty(found);
  },

  _search: function(hash){
    var self = this;
    var searchHash = _.clone(hash);
    var found = false;

    _.each(_.keys(self.criterium), function(criteriaKey){
      var criteria = self.criterium[criteriaKey];
      var searchTerm = self.columnName + '__' + criteria;
      var nsearchTerm = '-' + self.columnName + '__' + criteria;
      var searchVal = null;
      var negated = false;
      if(_.has(searchHash, searchTerm)){
        var searchVal = searchHash[searchTerm];
      }else if(_.has(searchHash, nsearchTerm)){
        var searchVal = searchHash[nsearchTerm];
        negated=true;
      }
      if(searchVal !== null){
        found = true;
        self.setValue('lower_criteria', criteriaKey);
        if(criteria == 'range'){
          self.$el.find('#range_upper_block').show();
          var vals = searchVal.split(',');
          self.setValue('lower_value', vals[0]);
          self.setValue('upper_value', vals[1]);
        }else if(criteria == 'in'){
          self.$el.find('[data-fields="lower_value"]')
            .find('input').prop('disabled', true);
          self.setValue('lower_value', '');
          self.$el.find('[data-fields="form_textarea"]').show();
          self.setValue('form_textarea', searchVal);
        }else if(criteria == 'is_null'){
          if(searchVal == false || searchVal == 'false'){
            self.setValue('lower_criteria', 'not blank');
          }
        }else{
          self.setValue('lower_value', searchVal);
        }

        if(negated){
          self.setValue('invert_field', true);
        }
      }
    });
    return found;
  },

  _getSearchHash: function(){
    var self = this;
    var searchHash = {};
    var values = self.getValue();
    var name = self.columnName;

    var searchHash = {};
    var invert = values['invert_field'];
    if(invert) name = '-'+name;
    var criteria = self.criterium[values['lower_criteria']];
    var searchKey = name + '__' + criteria;

    if(criteria == 'in'){
      searchHash[searchKey] = values['form_textarea'];
    }else if(criteria == 'is_null'){
      searchHash[searchKey] = 'true';
    }else if(criteria == 'not_blank'){
      var searchKey = name + '__is_null';
      searchHash[searchKey] = 'false';
    }else if(''+values['lower_value'] !== ''){
      if(criteria == 'range'){
        if(''+values['upper_value'] !== ''){
          searchKey = name + '__' + criteria;
          searchHash[searchKey] = values['lower_value'] + ',' + values['upper_value'];
        }else{
          console.log('upper value not set; validation should have caught this');
        }
      }else{
        searchHash[searchKey] = ''+values['lower_value'];
      }
    }
    return searchHash;
  },

  _submit: function(){
    var self  = this;
    if(!self.isSet()) return;
    var errors = self.commit({ validate: true });
    if(!_.isEmpty(errors)){
      console.log('form errors, abort submit: ' + JSON.stringify(errors));
      this.$el.find('#range_upper_block').addClass(self.errorClass);
      return;
    }else{
      this.$el.find('#range_upper_block').removeClass(self.errorClass);
    }

    return self._getSearchHash();
  }
});

var SIUnitFormFilter = NumberFormFilter.extend({

  symbol: "",

  // provide a custom form template; use Bootstrap layout/styling
  template: _.template([
      '<form class="iccbl-headerfield-form" >',
      '<div class="row center-block" style="margin: 0 0 0 0;" >',
      '<div class="input-group  col-sm-2">',
      '   <div data-fields="lower_criteria" ',
      '     class="input-group-addon iccbl-headerfield-number" for="lower_value"   />',
      '   <div data-fields="lower_value"/>',
      '   <div class="input-group-addon iccbl-headerfield-number" data-fields="lower_siunit"/>',
      '</div>',
      '<div class="form-group" data-fields="form_textarea" style="display: none;" />',
      '<div class="input-group" id="range_upper_block" style="display: none;" >',
      '   <span class="input-group-addon" for="upper_value"  style="width: 4em; ">to</span>',
      '   <span data-fields="upper_value"/>',
      '   <div class="input-group-addon iccbl-headerfield-number" data-fields="upper_siunit"/>',
      '</div>',
      '</div>',
      '<div class=""  data-fields="invert_field" />',
      '</form>'
    ].join('')),

  siunits: [
      ['T', 1e12],
      ['G', 1e9],
      ['M', 1e6],
      ['k', 1e3],
      ['', 1],
      ['m', 1e-3,],
      ['μ', 1e-6,],
      ['n', 1e-9 ],
      ['p', 1e-12 ]
  ],

  initialize : function(options) {
    var self = this;

    this.fieldinformation = options.fieldinformation || this.fieldinformation;
    if (_.isUndefined(this.fieldinformation)){
      throw 'must define a fieldinformation for SIUnitFormFilter';
    }

    var options = _.extend({},this.fieldinformation['display_options'],options);

    if(!options.symbol)
    {
      throw new Error('SIUnitHeaderCell: field information requires the '+
          '"symbol" option');
    }
    var multiplier = this.multiplier = options.multiplier || 1;
    var symbol = this.symbol = options.symbol;
    var defaultUnit = this.defaultUnit = options.defaultUnit;
    var units = this.units = [];
    var formSchema = options.schema = options.schema || {};

    if(! options.symbol){
      throw 'Error: SIUnitFormFilter requires a "symbol" option'
    }
    this.defaultSymbol = null;
    _.each(this.siunits,function(pair){
      if(options.maxunit){
        if(options.maxunit < pair[1]) return;
      }
      if(options.minunit){
        if(options.minunit > pair[1]) return;
      }
      units.push({ val: pair[1], label: pair[0] + self.symbol });
      if (pair[1]==defaultUnit){
        self.defaultSymbol = pair[0] + self.symbol;
      }
    });
    formSchema['lower_siunit'] = {
      title: '',
      key:  'lower_siunit', // TODO: "key" not needed>?
      type: 'Select',
      options: units,
      template: _.template(self.criteriaTemplate),
      editorClass: 'form-control'
    };

    formSchema['upper_siunit'] = {
      title: '',
      key:  'upper_siunit', // TODO: "key" not needed>?
      type: 'Select',
      options: units,
      template: _.template(self.criteriaTemplate),
      editorClass: 'form-control'
    };

    options['fields'] = ['lower_siunit','upper_siunit']

    SIUnitFormFilter.__super__.initialize.call(this, options);

  },

  render: function(){
    SIUnitFormFilter.__super__.render.apply(this, arguments);

    // Fixme: these values must be set after render, because inheritance is not
    // proper for this class.
    if (_.isNumber(this.defaultUnit)){
      this.setValue('lower_siunit',this.defaultUnit);
      this.setValue('upper_siunit',this.defaultUnit);
    }
    return this;

  },

  isSet: function(){
    var values = this.getValue();
    if (_.isEmpty(values['lower_criteria'])){
      return false;
    }
    var found = _.find(_.keys(values), function(key){
      if(key == 'lower_criteria'
        || key == 'lower_siunit'
        || key == 'upper_siunit' ) return false;
      // signal isSet for any field value set
      return values[key] !== '';
    });
    return !_.isEmpty(found);
  },

  _printSearchHash: function(searchHash){
    var self = this;
    _.each(_.keys(searchHash), function(key){
      var nu = self._findNumberAndUnit(searchHash[key]);
      searchHash[key] = nu.number + '&nbsp;'
        + _.result(_.invert(_.object(self.siunits)),nu.unit,nu.unit)
        + self.symbol;
    });
    return SIUnitFormFilter.__super__._printSearchHash.call(this, searchHash);
  },

  _getSearchHash: function(){
    var self = this;
    var searchHash = {};
    var values = self.getValue();
    var name = self.columnName;

    var searchHash = SIUnitFormFilter.__super__._getSearchHash.call(this);
    if(!_.isEmpty(searchHash)){
      var searchKey = _.keys(searchHash)[0];
      var searchValue = searchHash[searchKey];
      var values = self.getValue();
      var criteria = self.criterium[values['lower_criteria']];

      if(criteria == 'range'){
        searchHash[searchKey] = [
            self._calculate(
              self.multiplier,values['lower_siunit'],values['lower_value']),
            self._calculate(
              self.multiplier,values['upper_siunit'],values['upper_value'])
            ].join(',');
      }else if(criteria == 'in'){
        var newvalues = _.map(searchValue.split(','),function(val){
          return ''+self._calculate(self.multiplier,values['lower_siunit'],val);
        });
        searchHash[searchKey] = newvalues.join(',');
      }else if(criteria == 'is_null'){
        // do nothing it's good already
      }else if(criteria == 'not_blank'){
        // do nothing it's good already
      }else{
        searchHash[searchKey] = ''+self._calculate(
            self.multiplier,values['lower_siunit'],values['lower_value']);
      }
      if (Iccbl.appModel.DEBUG) console.log('SIunit new search value: ' + searchHash[searchKey]);
    }
    return searchHash;
  },


  /**
   * SIUnitFormFilter Form submit handler
   */
  _submit: function(){
    var self = this;
    SIUnitFormFilter.__super__._submit.call(this);
    return self._getSearchHash();
  },

  _calculate: function(multiplier, sci_mult, val){
    val = val / multiplier;
    if(sci_mult > 0){ // if sci unit is undefined, assume to be 1
      val = maxPrecision(val * sci_mult);
    } else {
      val = maxPrecision(val);
    }
    return val;
  },

  _findNumberAndUnit: function(number){
    var decimals = 3; // TODO: users will not be expected to enter values beyond
                      // 3 decimals
    var self = this;
    number = maxPrecision(number/self.multiplier);
    pair = _.find(this.siunits, function(pair){
      return pair[1] <= Math.abs(number);
    });

    if(_.isUndefined(pair)){
      console.log('could not find units for the input number: ' + number);
      return { number:number, unit: ''};
    }

    var val = (1/pair[1])*number;
    //val = Math.round(val*Math.pow(10,decimals))/Math.pow(10,decimals);
    val = round(val,decimals);
    return {number:val, unit: pair[1]};
  },

  _search: function(hash){
    var self = this;
    var searchHash = _.clone(hash);
    var found = SIUnitFormFilter.__super__._search.call(this, hash);
    if(found){
      var values = self.getValue();

      if(values['lower_value'] !== ''){
        var numberAndUnit = self._findNumberAndUnit(values['lower_value']);
        self.setValue('lower_value', numberAndUnit.number);
        self.setValue('lower_siunit', numberAndUnit.unit);
      }
      if(values['upper_value'] !== ''){
        var numberAndUnit = self._findNumberAndUnit(values['upper_value']);
        self.setValue('upper_value', numberAndUnit.number);
        self.setValue('upper_siunit', numberAndUnit.unit);
      }
    }
    return found;
  }

});

/**
 * Return an array for backgrid column descriptors.
 *
 * @param {Object}
 *          prop - hash of field properties from REST metadata: field properties {
 *          visibility: [array of strings], title: a label for the field, order:
 *          display order of the field , data_type: determines the type of header
 *          cell }
 * @param {Object}
 *          optionalHeaderCell - a Backgrid.HeaderCell to use for each column
 * @param {string}
 *          key - field information key in the metahash
 * @param {array}
 *          orderStack - for rendering ordered columns
 */
var createBackgridColumn = Iccbl.createBackgridColumn =
  function(key, prop, _orderStack, optionalHeaderCell ){

  var orderStack = _orderStack || [];
  var column = {};
  var visible = _.has(prop, 'visibility') &&
                    _.contains(prop['visibility'], 'l');
  var data_type = _.isEmpty(prop.data_type)?'string':prop.data_type.toLowerCase();
  var display_type = _.isEmpty(prop.display_type)?data_type:prop.display_type.toLowerCase();
  var cell_options = prop.display_options || {};
  var edit_type = _.isEmpty(prop.edit_type)?display_type:prop.edit_type.toLowerCase();

  var backgridCellType = StringCell;
  var typeMap = {
    'date': Iccbl.DateCell2,
    'link': Iccbl.LinkCell,
    'siunit': Iccbl.SIUnitsCell,
    'float': Iccbl.NumberCell, //'Number',
    'integer': Iccbl.IntegerCell,
    'decimal': Iccbl.DecimalCell,
    'image': Iccbl.ImageCell,
    'boolean': Iccbl.BooleanCell,
    'list': Iccbl.StringCell,
    'full_string': Iccbl.TextWrapCell,
    'comment_array': Iccbl.CommentArrayCell
  }

  if(!_.isEmpty(prop.vocabulary)){
    cell_options.optionValues = prop.vocabulary;
  }else if(!_.isEmpty(prop.vocabulary_scope_ref)){
    cell_options = _.extend(cell_options,{
      optionValues:
        Iccbl.appModel.getVocabularySelectCellArray(prop.vocabulary_scope_ref),
      vocabulary_scope_ref: prop.vocabulary_scope_ref
    });
  }

  if (_.has(prop, 'backgridCellType')){
    if (Iccbl.appModel.DEBUG){
      console.log('using specified "backgridCellType": ',key, prop.backgridCellType );
    }
    backgridCellType = prop.backgridCellType;
    if(!_.isEmpty(cell_options)){
      cell_options = _.extend({}, cell_options, backgridCellType);
      backgridCellType = backgridCellType.extend(cell_options);
    }
  } else {
    if(!_.isEmpty(cell_options.optionValues)){
      backgridCellType = Iccbl.SelectCell;
    }else if(_.has(typeMap,display_type)){
      if (Iccbl.appModel.DEBUG)
        console.log('field', key, display_type, 'typemap',typeMap[display_type])
      var backgridCellType = typeMap[display_type];

      if (display_type=='link'){
        if (data_type == 'list'){
          backgridCellType = Iccbl.UriListCell;
        }else if (data_type == 'date'){
          backgridCellType = Iccbl.DateLinkCell;
        }else if (data_type == 'integer'){
          backgridCellType = Iccbl.LinkCell.extend({
              formatter: new Iccbl.IntegerFormatter(cell_options)
            });
        }
      }
    }else{
      if (Iccbl.appModel.DEBUG)
        console.log('no special cell type for', display_type, 'data_type',data_type);
    }
    if(!_.isEmpty(cell_options)){
      backgridCellType = backgridCellType.extend(cell_options);
    } else {
      // Empty cell options for numbers means show raw
      backgridCellType = backgridCellType.extend({ no_format: true });
    }

  }
  column = _.extend(column, {
    'name' : key,
    'label' : prop['title'],
    'description' : prop['description'],
    'mouseover' : _.result(prop, 'mouseover', prop['description']),
    'cell' : backgridCellType,
    'order' : prop['ordinal'],
    'sortable': prop['ordering'],
    'searchable': prop['filtering'],
    'editable' : false,
    'visible': visible,
    'fieldinformation': prop
  });
  
  if (prop.is_admin){
    column['description'] += ' (Admin field)';
    column['mouseover'] += ' (Admin field)';
  }
  
  if(_.has(prop,'editability') && _.contains(prop['editability'],'l')){
    column['editable'] = true;
  }
  if(orderStack && _.contains(orderStack, key)){
    column['direction'] = 'ascending';
  }
  else if(orderStack && _.contains(orderStack, '-' + key)){
    column['direction'] = 'descending';
  }

  var headerCellDefaults = {
    'fieldinformation': prop,
    'serverSideFilter': TextFormFilter
  };
  if (optionalHeaderCell) {
    
    column['headerCell'] = optionalHeaderCell.extend(headerCellDefaults, {
      render : function() {
        var self = this;
        optionalHeaderCell.__super__.render.apply(this);
        if (this.fieldinformation && this.fieldinformation.is_admin){
          this.$el.append(
            "<span style='margin-bottom: 2px;' "
            + "class='label label-warning label-as-badge pull-right strong' "
            + "title='admin field'>A</span>");
        }
        return this;
      }      
    });
  }else if (_.has(prop, 'headerCell')){
    column['headerCell'] = prop.headerCell.extend(headerCellDefaults, {
      render : function() {
        var self = this;
        prop.headerCell.__super__.render.apply(this);
        if (this.fieldinformation && this.fieldinformation.is_admin){
          this.$el.append(
            "<span style='margin-bottom: 2px;' "
            + "class='label label-warning label-as-badge pull-right strong' "
            + "title='admin field'>A</span>");
        }
        return this;
      }      
    });
  }
  else{
    // Set up a more specific header cell, with filter
    if(data_type == 'string'){
      headerCellDefaults['serverSideFilter'] = TextFormFilter;
    }
    else if(data_type == 'integer'
      || data_type == 'float'
      || data_type == 'decimal' ){

      if(display_type == 'siunit'){
        headerCellDefaults['serverSideFilter'] = SIUnitFormFilter;
      } else {
        headerCellDefaults['serverSideFilter'] = NumberFormFilter;
      }
    }
    else if( data_type == 'date'){
      headerCellDefaults['serverSideFilter'] = DateFormFilter;
    }
    else if( data_type == 'boolean'){
      headerCellDefaults['serverSideFilter'] = BooleanFormFilter;
    }

    if( edit_type == 'select'
      || edit_type == 'multiselect'
      || edit_type == 'multiselect2'
      || edit_type == 'multiselect3'

    ){
      headerCellDefaults['serverSideFilter'] = SelectorFormFilter;
    }
    column['headerCell'] = FilterHeaderCell.extend(headerCellDefaults);
  }

  return column;
};


var createBackgridColModel = Iccbl.createBackgridColModel =
  function(restFields, _orderStack, _searchHash, _manualIncludes) {

  console.log('--createBackgridColModel');
  var manualIncludes = _manualIncludes || [];
  var orderStack = _orderStack || [];
  var searchHash = _searchHash || {};

  var colModel = [];
  var i = 0;
  var _total_count = 0;
  _.each(_.pairs(restFields), function(pair) {
    var key = pair[0];
    var prop = pair[1];
    var column = createBackgridColumn(key, prop, orderStack);
    column.key = key;
    var visible = _.has(prop, 'visibility') &&
      _.contains(prop['visibility'], 'l');
    if (visible || _.contains(manualIncludes, key) ) {
      if(_.contains(manualIncludes, '-'+key)){
        console.log('Column: ' + key + ' is manually excluded');
      }else{
        colModel[i] = column;
        i++;
      }
    } else {
      var hashSearch = RegExp('^(' + key + ')(_{2}\w+)?$');
      var orderSearch = RegExp('^-?' + key + '$');
      if(
        _.findKey(searchHash, function(val,hashkey){
          return hashSearch.test(hashkey);
        })
        ||  _.find(orderStack, function(orderkey){
          return orderSearch.test(orderkey);
        }))
      {
        if (!_.contains(manualIncludes, '-'+key)){
          colModel[i] = column;
          i++;
        }
      }
    }
  });

  colModel = new Backgrid.Columns(colModel);
  colModel.comparator = 'order';
  colModel.sort();
  return colModel;
};


return Iccbl;
});
