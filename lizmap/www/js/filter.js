var lizSmartLayer = function() {

    lizMap.events.on({
        'uicreated':function(evt){

        if (typeof variable != "undefined")
            return true;


        // Compute the HTML container for the form
        function getSmartFilterDockRoot(){
            var html = '';

            html+= '<div class="menu-content">';
            // Add total feature counter
            var total = 0
            html+= '<b><span id="liz-filter-item-layer-total-count">' + total + '</span> '+lizDict['filter.label.features']+'</b>';

            // Add zoom link
            html+= '<br/><button id="liz-filter-zoom" class="btn btn-mini btn-primary" title="'+lizDict['filter.btn.zoom.title']+'">'+lizDict['filter.btn.zoom.label']+'</button>';

            // Add export button
            html+= '&nbsp;&nbsp;<button id="liz-filter-export" class="btn btn-mini btn-primary" title="'+lizDict['filter.btn.zoom.title']+'">'+lizDict['filter.btn.export.label']+'</button>';

            // Add unfilter link
            html+= '&nbsp;&nbsp;<button id="liz-filter-unfilter" class="btn btn-mini btn-primary" title="'+lizDict['filter.btn.zoom.title']+'">'+lizDict['filter.btn.reset.label']+'</button>';

            html+= '</div>';

            // Add tree
            html+= '<div style="padding:10px 10px;" class="tree menu-content"></div>';

            return html;
        }

        // Launch the form filter feature
        function launchSmartLayer(){

            // Build interface html code
            // Add dock
            var html = getSmartFilterDockRoot();

            $('#filter-content').html(html);

            // Get html
            getSmartLayerFilterForm();

            // Limit dock size
            adaptSmartLayerSize();

            if( filterConfig['showAtStartup'] == 'true' ){
                // Show search dock
                $('#mapmenu li.filter:not(.active) a').click();

            }

            // Activate the unfilter link
            $('#liz-filter-unfilter').click(function(){
                // Remove filter
                deactivateFilter();
                return false;
            });

            // Activate the zoom button
            $('#liz-filter-zoom').click(function(){
                zoomToFeatures()
                return false;
            });

            // Activate the export button
            $('#liz-filter-export').click(function(){
                lizMap.exportVectorLayer(filterConfig.layername, 'ODS', false);
                return false;
            });

            // Get Feature count
            getFeatureCount();

            // Set default zoom extent setZoomExtent
            setZoomExtent();

            // Add tooltip
            $('#filter-content [title]').tooltip();

        }


        // Get the HTML form
        // By getting form element for each field
        function getSmartLayerFilterForm(){

            // Add form fields
            for(var fi in filterConfig.smartFields){
                var field_item = filterConfig.smartFields[fi];
                getFormFieldInput(field_item);
            }

        }


        // Get the HTML form elemnt for a specific field
        function getFormFieldInput(field_item){
            var field_config = filterConfig.smartFieldsConfig[field_item];

            // unique values
            if( field_config['type'] == 'uniqueValues' ){
                return uniqueValuesFormInput(field_item);
            }

            // date
            if( field_config['type'] == 'date' ){
                return dateFormInput(field_item);
            }

            // numeric
            if( field_config['type'] == 'numeric' ){
                return numericFormInput(field_item);
            }

            // text
            if( field_config['type'] == 'text' ){
                return textFormInput(field_item);
            }

            return '';
        }

        function getFormFieldHeader(field_item){
            var field_config = filterConfig.smartFieldsConfig[field_item];

            var html = '';
            html+= '<div class="liz-filter-field-box" id="liz-filter-box-';
            html+= lizMap.cleanName(field_item);
            html+= '">';
            var flabel = field_item;
            html+= '<span style="font-weight:bold;">' + flabel +'</span>';
            html+= '<button class="btn btn-primary btn-mini pull-right liz-filter-reset-field" title="'+lizDict['filter.btn.reset.title']+'" value="'+field_item+'">x</button>';
            html+= '<p>';

            return html;
        }

        function getFormFieldFooter(field_item){
            var html = '';
            html+= '</p>';
            html+= '</div>';

            return html;
        }

        // Get the HTML form element for the uniqueValues field type
        function dateFormInput(field_item){
            var field_config = filterConfig.smartFieldsConfig[field_item];
            var sdata = {
                request: 'getMinAndMaxValues',
                layerId: filterConfig.layerId,
                fieldname: field_config['options']['startField'] + ',' + field_config['options']['endField'],
                filter: ''
            };
            $.get(filterConfig.url, sdata, function(result){
                if( !result )
                    return false;
                if( 'status' in result && result['status'] == 'error' ){
                    console.log(result.title + ': ' + result.detail);
                    return false;
                }
                for(var a in result){
                    var feat = result[a];
                    filterConfig.smartFieldsConfig[field_item]['options']['min'] = feat['min'];
                    filterConfig.smartFieldsConfig[field_item]['options']['max'] = feat['max'];
                }

                var html = '';
                html+= getFormFieldHeader(field_item);
                html+= '<span style="white-space:nowrap">';
                html+= '<input id="liz-filter-field-min-date' + lizMap.cleanName(field_item) + '" class="liz-filter-field-date" value="'+field_config['options']['min']+'" style="width:100px;">';
                //html+= '&nbsp;-&nbsp;';
                html+= '<input id="liz-filter-field-max-date' + lizMap.cleanName(field_item) + '" class="liz-filter-field-date" value="'+field_config['options']['max']+'" style="width:100px;">';
                html+= '</span>';

                // http://jsfiddle.net/Lcrsd3jt/45/
                // pour avoir un date et time picker, see https://github.com/trentrichardson/jQuery-Timepicker-Addon
                html+= '<div id="liz-filter-datetime-range'+ lizMap.cleanName(field_item)+'">';
                html+= '    <div>';
                html+= '        <div id="liz-filter-slider-range'+ lizMap.cleanName(field_item)+'"></div>';
                html+= '    </div>';
                html+= '</div>';

                html+= getFormFieldFooter(field_item);

                $("#filter div.tree").append(html);
                $("#filter input.liz-filter-field-date").datepicker({
                    //showOn: "button",
                    //buttonText: "Select date",
                    dateFormat: field_config['options']['dateFormat'],
                    changeMonth: true,
                    changeYear: true,
                    maxDate: "+0D"
                });

                addFieldEvents(field_item);

            }, 'json');

        }

        // Get the HTML form element for the uniqueValues field type
        function numericFormInput(field_item){
            var field_config = filterConfig.smartFieldsConfig[field_item];
            var sdata = {
                request: 'getMinAndMaxValues',
                layerId: filterConfig.layerId,
                fieldname: field_config['options']['field'],
                filter: ''
            };
            $.get(filterConfig.url, sdata, function(result){
                if( !result )
                    return false;
                if( 'status' in result && result['status'] == 'error' ){
                    console.log(result.title + ': ' + result.detail);
                    return false;
                }
                for(var a in result){
                    var feat = result[a];
                    filterConfig.smartFieldsConfig[field_item]['options']['min'] = Number(feat['min']);
                    filterConfig.smartFieldsConfig[field_item]['options']['max'] = Number(feat['max']);
                }

                var html = '';
                html+= getFormFieldHeader(field_item);
                html+= '<span style="white-space:nowrap">';
                html+= '<input id="liz-filter-field-min-numeric' + lizMap.cleanName(field_item) + '" type="number" value="'+field_config['options']['min']+'" step="'+field_config['options']['step']+'" min="'+field_config['options']['min']+'" max="'+field_config['options']['max']+'" class="liz-filter-field-numeric" style="width:100px;">';
                //html+= '&nbsp;-&nbsp;';
                html+= '<input id="liz-filter-field-max-numeric' + lizMap.cleanName(field_item) + '" type="number" value="'+field_config['options']['max']+'" step="'+field_config['options']['step']+'" min="'+field_config['options']['min']+'" max="'+field_config['options']['max']+'" class="liz-filter-field-numeric" style="width:100px;">';
                html+= '</span>';

                html+= '<div id="liz-filter-numeric-range'+ lizMap.cleanName(field_item)+'">';
                html+= '    <div>';
                html+= '        <div id="liz-filter-slider-range'+ lizMap.cleanName(field_item)+'"></div>';
                html+= '    </div>';
                html+= '</div>';

                html+= getFormFieldFooter(field_item);

                $("#filter div.tree").append(html);

                addFieldEvents(field_item);


            }, 'json');

        }

        // Get the HTML form element for the uniqueValues field type
        function textFormInput(field_item){
            var field_config = filterConfig.smartFieldsConfig[field_item];
            var html = '';
            html+= getFormFieldHeader(field_item);
            html+= '<div style="width: 100%;">'
            html+= '<input id="liz-filter-field-text' + lizMap.cleanName(field_item) + '" class="liz-filter-field-text" value="" title="'+lizDict['filter.input.text.title']+'" placeholder="'+lizDict['filter.input.text.placeholder']+'">';
            html+= '</div>'
            html+= getFormFieldFooter(field_item);

            $("#filter div.tree").append(html);
            addFieldEvents(field_item);
        }

        // Get the HTML form element for the uniqueValues field type
        // possible format: checkboxes or select
        function uniqueValuesFormInput(field_item){

            var field_config = filterConfig.smartFieldsConfig[field_item];

            var html = '';
            html+= getFormFieldHeader(field_item);
            if ( field_config.options.format == 'select' ) {
                html+= '<select id="liz-filter-field-' + lizMap.cleanName(field_item) + '" class="liz-filter-field-select">';
                html+= '<option value=""> --- </option>';
                html+= '</select>';
            }
            html+= getFormFieldFooter(field_item);

            $("#filter div.tree").append(html);

            // Get unique values data (and counters)
            var field = field_config['options']['field'];
            var sdata = {
                request: 'getUniqueValues',
                layerId: filterConfig.layerId,
                fieldname: field,
                filter: ''
            };
            $.get(filterConfig.url, sdata, function(result){
                if( !result )
                    return false;
                if( 'status' in result && result['status'] == 'error' ){
                    console.log(result.title + ': ' + result.detail);
                    return false;
                }
                if( !('items' in filterConfig.smartFieldsConfig[field_item]) )
                    filterConfig.smartFieldsConfig[field_item]['items'] = {};
                for(var a in result){
                    var feat = result[a];
                    filterConfig.smartFieldsConfig[field_item]['items'][feat['v']] = feat['c'];
                }

                var dhtml = '';
                var fkeys = Object.keys(
                    filterConfig.smartFieldsConfig[field_item]['items']
                );

                // Order fkeys alphabetically (which means sort checkboxes for each field)
                fkeys.sort();

                for( var z in fkeys ){
                    var f_val = fkeys[z];
                    var label = f_val;

                    if ( field_config.options.format == 'select' ) {
                        dhtml+= '<option value="' + lizMap.cleanName(f_val) +'">';
                    } else {
                        var inputId = 'liz-filter-field-' + lizMap.cleanName(field_item) + '-' + lizMap.cleanName(f_val);
                        dhtml+= '<span style="font-weight:normal;">';

                        dhtml+= '<button id="' + inputId + '" class="btn checkbox liz-filter-field-value" value="' + lizMap.cleanName(f_val) +'"></button>';

                    }
                    dhtml+= '&nbsp;' + label;

                    // Add counter
                    //dhtml+= '&nbsp;(' + '<span class="liz-filter-field-counter">';
                    //dhtml+= filterConfig.smartFieldsConfig[field_item]['items'][f_val];
                    //dhtml+= '</span>' + ')';

                    // close item
                    if ( field_config.options.format == 'select' ) {
                        dhtml+= '</option>';
                    } else {
                        dhtml+= '</span></br>';
                    }

                }
                var id = 'liz-filter-box-' + lizMap.cleanName(field_item);
                if ( field_config.options.format == 'select' ){
                    $('#' + id + ' select').append(dhtml);
                }else{
                    $('#' + id + ' p').append(dhtml);
                }

                addFieldEvents(field_item);
            }, 'json');

        }


        // Generate filter string for a field
        // Depending on the selected inputs
        function setFormFieldFilter(field_item){
            if( filterConfig.deactivated )
                return false;

            var field_config = filterConfig.smartFieldsConfig[field_item];

            // Set filter depending on field type
            // Unique values
            if( field_config['type'] == 'uniqueValues' ){
                setUniqueValuesFilter(field_item);
            }

            // Dates
            if( field_config['type'] == 'date' ){
                setDateFilter(field_item);
            }

            // Numeric
            if( field_config['type'] == 'numeric' ){
                setNumericFilter(field_item);
            }

            // Texte
            if( field_config['type'] == 'text' ){
                setTextFilter(field_item);
            }

            // Update global form filter
            setFormFilter();
        }

        // Set the filter for the uniqueValues field type
        function setUniqueValuesFilter(field_item){
            var field_config = filterConfig.smartFieldsConfig[field_item];

            // First loop through each field value
            // And check if the item (e.g checkbox) is selected or not
            filterConfig.smartFieldsConfig[field_item]['data'] = {}
            var allchecked = true;
            var nonechecked = true;
            if ( field_config.options.format == 'select' ) {
                var selectId = '#liz-filter-field-' + lizMap.cleanName(field_item);
                var selectVal = $(selectId).val();
                var clist = [];
                for(var f_val in filterConfig.smartFieldsConfig[field_item]['items']){
                    // Get checked status
                    var achecked = (selectVal == lizMap.cleanName(f_val));
                    if(!achecked){
                        allchecked = false;
                    }else{
                        nonechecked = false;
                        clist.push(f_val.replace("'", "''"));
                    }
                    filterConfig.smartFieldsConfig[field_item]['data'][f_val] = achecked;
                }
            }
            if ( field_config.options.format == 'checkboxes' ) {
                var clist = [];
                for(var f_val in filterConfig.smartFieldsConfig[field_item]['items']){
                    // Get checked status
                    var inputId = '#liz-filter-field-' + lizMap.cleanName(field_item) + '-' + lizMap.cleanName(f_val);
                    var achecked = $(inputId).hasClass('checked');
                    if(!achecked){
                        allchecked = false;
                    }else{
                        nonechecked = false;
                        clist.push(f_val.replace("'", "''"));
                    }
                    filterConfig.smartFieldsConfig[field_item]['data'][f_val] = achecked;
                }
            }
            filterConfig.smartFieldsConfig[field_item]['allchecked'] = allchecked;
            filterConfig.smartFieldsConfig[field_item]['nonechecked'] = nonechecked;
            filterConfig.smartFieldsConfig[field_item]['selected'] = clist;
            var filter = null;
            var field = field_config['options']['field'];
            if(clist.length){
                filter = '"' + field + '"' + " IN ( '" + clist.join("' , '") + "' ) ";
            }
            filterConfig.smartFieldsConfig[field_item]['filter'] = filter;

        }

        // Set the filter for the Date type
        function setDateFilter(field_item){
            var field_config = filterConfig.smartFieldsConfig[field_item];
            var filters = [];

            // get input values
            var min_id = '#liz-filter-field-min-date' + lizMap.cleanName(field_item);
            var max_id = '#liz-filter-field-max-date' + lizMap.cleanName(field_item);
            var min_val = $(min_id).val().trim();
            var max_val = $(max_id).val().trim();

            // Do nothing if min and max values entered equals the field min and max possible values
            if( min_val == field_config['options']['min'] && max_val == field_config['options']['max'] ){
                filterConfig.smartFieldsConfig[field_item]['filter'] = null;
                return true;
            }

            // fields
            var startField = field_config['options']['startField'];
            var endField = field_config['options']['endField'];

            // min date filter
            if(min_val && Date.parse(min_val)){
                filters.push('( "' + startField + '"' + " >= '" + min_val + "'" + " OR " + ' "' + endField + '"' + " >= '" + min_val + "' )");
            }else{
                min_val = null;
            }

            // max date filter
            if(max_val && Date.parse(max_val)){
                filters.push('( "' + startField + '"' + " <= '" + max_val + "'" + " OR " + ' "' + endField + '"' + " <= '" + max_val + "' )");
            }else{
                max_val = null;
            }

            var filter = null;
            if(filters.length){
                var filter = ' ( ';
                filter+= filters.join(' AND ');
                filter+= ' ) ';
            }
            filterConfig.smartFieldsConfig[field_item]['data'] = {
                'min_date': min_val,
                'max_date': max_val
            };
            filterConfig.smartFieldsConfig[field_item]['filter'] = filter;

        }

        // Set the filter for the Numeric type
        function setNumericFilter(field_item){
            var field_config = filterConfig.smartFieldsConfig[field_item];
            var filters = [];

            // get input values
            var min_id = '#liz-filter-field-min-numeric' + lizMap.cleanName(field_item);
            var max_id = '#liz-filter-field-max-numeric' + lizMap.cleanName(field_item);
            var min_val = $(min_id).val().trim();
            var max_val = $(max_id).val().trim();

            // Do nothing if min and max values entered equals the field min and max possible values
            if( min_val == field_config['options']['min'] && max_val == field_config['options']['max'] ){
                filterConfig.smartFieldsConfig[field_item]['filter'] = null;
                return true;
            }

            // field
            var field = field_config['options']['field'];

            // min value filter
            if(min_val != ''){
                filters.push('( "' + field + '"' + " >= '" + min_val + "' )" );
            }else{
                min_val = null;
            }

            // max value filter
            if(max_val != ''){
                filters.push('( "' + field + '"' + " <= '" + max_val + "' )");
            }else{
                max_val = null;
            }

            var filter = null;
            if(filters.length){
                var filter = ' ( ';
                filter+= filters.join(' AND ');
                filter+= ' ) ';
            }
            filterConfig.smartFieldsConfig[field_item]['data'] = {
                'min': min_val,
                'max': max_val
            };
            filterConfig.smartFieldsConfig[field_item]['filter'] = filter;

        }

        // Set the filter for a text field_item
        function setTextFilter(field_item){

            var field_config = filterConfig.smartFieldsConfig[field_item];
            var id = '#liz-filter-field-text' + lizMap.cleanName(field_item);
            var val = $(id).val().trim().replace("'", "''");

            filterConfig.smartFieldsConfig[field_item]['data'] = {
                'text': val
            };
            var filter = null;
            var field = field_config['options']['field'];
            if(val){
                filter = '"' + field + '"' + " ILIKE '%" + val + "%'";
            }

            filterConfig.smartFieldsConfig[field_item]['data'] = {
                'text': val
            };
            filterConfig.smartFieldsConfig[field_item]['filter'] = filter;
        }


        // Compute the global filter to pass to the layer
        function setFormFilter(){
            var afilter = []
            for(var fi in filterConfig.smartFields){
                var field_item = filterConfig.smartFields[fi];
                var field_config = filterConfig.smartFieldsConfig[field_item];
                if(field_config['filter']){
                    afilter.push(field_config['filter']);
                }
            }
            var filter = afilter.join(' AND ');
//console.log(filter);

            // Trigger the filter on the layer
            var layername = filterConfig.layername;
            triggerLayerFilter(layername, filter);

            getFeatureCount(filter);

            setZoomExtent(filter);

        }


        // Apply the global filter on the layer
        function triggerLayerFilter(layername, filter){

            // Get layer information
            var layerN = layername;
            var layer = null;
            var layers = lizMap.map.getLayersByName( lizMap.cleanName(layername) );
            if( layers.length == 1) {
                layer = layers[0];
            }
            if(!layer)
                return false;
            if( layer.params) {
                layerN = layer.params['LAYERS'];
            }

            // Add filter to the layer
            var lfilter = layerN + ':' + filter;
            layer.params['FILTER'] = lfilter;
            lizMap.config.layers[layername]['request_params']['filter'] = lfilter;
            lizMap.config.layers[layername]['request_params']['exp_filter'] = filter;
            //layer.redraw(true);
            layer.redraw();

            // Get filter token
            //var surl = OpenLayers.Util.urlAppend(lizUrls.wms
                //,OpenLayers.Util.getParameterString(lizUrls.params)
            //);
            //var sdata = {
                //service: 'WMS',
                //request: 'GETFILTERTOKEN',
                //typename: layerN,
                //filter: lfilter
            //};
            //$.post(surl, sdata, function(result){
                //layer.params['FILTERTOKEN'] = result.token;
                //delete layer.params['FILTER'];
                //lizMap.config.layers[layername]['request_params']['filter'] = null;
                //lizMap.config.layers[layername]['request_params']['filtertoken'] = result.token;
                //if( lizMap.config.layers[layername]['geometryType']
                    //&& lizMap.config.layers[layername].geometryType != 'none'
                    //&& lizMap.config.layers[layername].geometryType != 'unknown'
                //){
                    //layer.redraw();
                //}
            //});

            // Tell popup to be aware of the filter
            lizMap.events.triggerEvent("layerFilterParamChanged",
                {
                    'featureType': layerN,
                    'filter': lfilter,
                    'updateDrawing': false
                }
            );

            // Refresh attributable table if displayed
            // Need to publish method buildLayerAttributeDatatable
            //var cleanName = lizMap.cleanName(layername);
            //if( $('#attribute-layer-main-' + cleanName).length ){

                //var aTable = '#attribute-layer-table-' + cleanName;
                //var dFilter = filter;
                //$('#attribute-layer-main-' + cleanName + ' > div.attribute-layer-content').hide();
                //lizMap.getAttributeFeatureData( layerN, dFilter, null, 'extent', function(someName, someNameFilter, someNameFeatures, someNameAliases){
                    //buildLayerAttributeDatatable( someName, aTable, someNameFeatures, someNameAliases );
                    //$('#attribute-layer-main-' + cleanName + ' > div.attribute-layer-content').show();
                //});
            //}

            return true;
        }


        // Deactivate the layer filter
        // And display all features
        function deactivateFilter(){

            // Deactivate all triggers to avoid unnecessary requests
            filterConfig.deactivated = true;
            for(var fi in filterConfig.smartFields){
                var field_item = filterConfig.smartFields[fi];
                resetFormField(field_item);
            }
            filterConfig.deactivated = false;

            // Remove filter on map layers
            var layername = filterConfig.layername;
            deactivateMaplayerFilter(layername);

            // Refresh plots
            lizMap.events.triggerEvent("layerFilterParamChanged",
                {
                    'featureType': layername,
                    'filter': null,
                    'updateDrawing': false
                }
            );

            // Get feature count
            getFeatureCount();

            // Set zoom extent
            setZoomExtent();

            // Remove feature info geometry
            removeFeatureInfoGeometry();

        }

        function resetFormField(field_item){
            var field_config = filterConfig.smartFieldsConfig[field_item];

            if( field_config['type'] == 'date' ){
                $('#liz-filter-field-min-date' + lizMap.cleanName(field_item)).val(field_config['options']['min']);
                $('#liz-filter-field-max-date' + lizMap.cleanName(field_item)).val(field_config['options']['max']).change(); // .change() so that the slider is also resetted
            }
            else if( field_config['type'] == 'numeric' ){
                $('#liz-filter-field-min-numeric' + lizMap.cleanName(field_item)).val(field_config['options']['min']);
                $('#liz-filter-field-max-numeric' + lizMap.cleanName(field_item)).val(field_config['options']['max']).change();
            }
            else if( field_config['type'] == 'uniqueValues' ){
                if(field_config['options']['format'] == 'checkboxes'){
                    $('#liz-filter-box-' + lizMap.cleanName(field_item) + ' button.liz-filter-field-value.checked').removeClass('checked');
                }
                else if(field_config['options']['format'] == 'select'){
                    $('#liz-filter-field-' + lizMap.cleanName(field_item)).val(
                        $('#liz-filter-field-' + lizMap.cleanName(field_item)+ ' option:first').val()
                    );

                }
            }
            else if( field_config['type'] == 'text' ){
                $('#liz-filter-field-text' + lizMap.cleanName(field_item)).val('');
            }

            // Remove filter in stored object
            filterConfig.smartFieldsConfig[field_item]['filter'] = null;

        }

        function deactivateMaplayerFilter(layername){
            // Get layer information
            var layerN = layername;
            var layer = null;
            var layers = lizMap.map.getLayersByName( lizMap.cleanName(layername) );
            if( layers.length == 1) {
                layer = layers[0];
            }

            // Remove layer filter
            delete layer.params['FILTER'];
            delete layer.params['FILTERTOKEN'];
            delete layer.params['EXP_FILTER'];
            lizMap.config.layers[layername]['request_params']['exp_filter'] = null;
            lizMap.config.layers[layername]['request_params']['filtertoken'] = null;
            lizMap.config.layers[layername]['request_params']['filter'] = null;
            layer.redraw();

        }


        // Removes the getFeatureInfo geometry
        function removeFeatureInfoGeometry(){
            if(filterConfig.display_geometry){
                var layer = lizMap.map.getLayersByName('locatelayer');
                if ( layer.length == 1 )
                    layer[0].destroyFeatures();
            }
        }

        // Adapt the size of the dock
        function adaptSmartLayerSize(){
            lizMap.events.on({
                // Adapt dock size to display metadata
                dockopened: function(e) {
                    if ( e.id == 'filter') {
                        lizMap.updateContentSize();
                    }
                },
                rightdockclosed: function(e) {
                },
                minidockclosed: function(e) {
                },
                layerfeatureremovefilter: function(e){
                }
            });

        }

        function formatDT(aDate, dateFormat) {
            var formatted = $.datepicker.formatDate(dateFormat, aDate);
            return formatted;
        };

        // Add an event on the inputs of a given field
        // For example, do something when a checkox is clicked
        // This triggers the calculation of the filter for the field
        function addFieldEvents(field_item){
            var container = 'liz-filter-box-' + lizMap.cleanName(field_item);
            var field_config = filterConfig.smartFieldsConfig[field_item];

            if( field_config['type'] == 'uniqueValues' ){
                if( field_config['options']['format'] == 'checkboxes' ){
                    $('#' + container + ' button.liz-filter-field-value').click(function(){
                        var self = $(this);
                        // Do nothing if disabled
                        if (self.hasClass('disabled'))
                            return false;
                        // Add checked class if unchecked
                        if( !self.hasClass('checked') )
                            self.addClass('checked');
                        else
                            self.removeClass('checked');

                        // Filter the data
                        setFormFieldFilter(field_item);
                    });
                }
                if( field_config['options']['format'] == 'select' ){

                    $('#liz-filter-field-' + lizMap.cleanName(field_item)).change(function(){
                        // Filter the data
                        setFormFieldFilter(field_item);
                    });
                }
            }

            // date
            if( field_config['type'] == 'date' ){

                var hasSlider = (field_config['options']['slider']);
                if(hasSlider){
                    // Get value in seconds
                    var min_val = Date.parse(field_config['options']['min'])/1000;
                    var max_val = Date.parse(field_config['options']['max'])/1000;

                    // Add a function which will use a timeout
                    // to prevent too heavy load on server
                    // when using setFormFieldFilter
                    var timer = null;
                    function onDateChange(e, ui) {
                        if(filterConfig.deactivated)
                            return false;
                        clearTimeout(timer);
                        timer = setTimeout(function() {
                            var dt_cur_from = new Date(ui.values[0]*1000); //.format("yyyy-mm-dd hh:ii:ss");
                            $('#liz-filter-field-min-date' + lizMap.cleanName(field_item)).val(
                                formatDT(dt_cur_from, field_config['options']['dateFormat'])
                            )
                            var dt_cur_to = new Date(ui.values[1]*1000); //.format("yyyy-mm-dd hh:ii:ss");
                            $('#liz-filter-field-max-date' + lizMap.cleanName(field_item)).val(
                                formatDT(dt_cur_to, field_config['options']['dateFormat'])
                            )

                            setFormFieldFilter(field_item);
                        }, 150);
                    }

                    $("#liz-filter-slider-range"+ lizMap.cleanName(field_item)).slider({
                        range: true,
                        min: min_val,
                        max: max_val,
                        step: field_config['options']['step'],
                        values: [min_val, max_val],
                        change: function (e, ui) {
                            onDateChange(e, ui);
                        },
                        slide: function (e, ui) {
                            var dt_cur_from = new Date(ui.values[0]*1000); //.format("yyyy-mm-dd hh:ii:ss");
                            $('#liz-filter-field-min-date' + lizMap.cleanName(field_item)).val(
                                formatDT(dt_cur_from, field_config['options']['dateFormat'])
                            )
                            var dt_cur_to = new Date(ui.values[1]*1000); //.format("yyyy-mm-dd hh:ii:ss");
                            $('#liz-filter-field-max-date' + lizMap.cleanName(field_item)).val(
                                formatDT(dt_cur_to, field_config['options']['dateFormat'])
                            )
                        }
                    });
                }

                $('#liz-filter-field-min-date' + lizMap.cleanName(field_item) + ', #liz-filter-field-max-date' + lizMap.cleanName(field_item)).change(function(){
                    // Filter the data. Only if the slider is not activated (if it is activated, it triggers the filter)
                    if(!hasSlider){
                        setFormFieldFilter(field_item);
                    }else{
                        // Change values of the slider
                        $("#liz-filter-slider-range"+ lizMap.cleanName(field_item)).slider(
                            "values",
                            [
                                Date.parse($('#liz-filter-field-min-date' + lizMap.cleanName(field_item)).val())/1000,
                                Date.parse($('#liz-filter-field-max-date' + lizMap.cleanName(field_item)).val())/1000
                            ]
                        );
                    }
                });
            }

            // numeric
            if( field_config['type'] == 'numeric' ){

                var hasSlider = (field_config['options']['slider']);
                if(hasSlider){
                    var min_val = field_config['options']['min'];
                    var max_val = field_config['options']['max'];

                    // Add a function which will use a timeout
                    // to prevent too heavy load on server
                    // when using setFormFieldFilter
                    var timer = null;
                    function onNumericChange(e, ui) {
                        if(filterConfig.deactivated)
                            return false;
                        clearTimeout(timer);
                        timer = setTimeout(function() {
                            var dt_cur_from = ui.values[0];
                            $('#liz-filter-field-min-numeric' + lizMap.cleanName(field_item)).val(dt_cur_from);
                            var dt_cur_to = ui.values[1];
                            $('#liz-filter-field-max-numeric' + lizMap.cleanName(field_item)).val(dt_cur_to);

                            setFormFieldFilter(field_item);
                        }, 300);
                    }

                    $("#liz-filter-slider-range"+ lizMap.cleanName(field_item)).slider({
                        range: true,
                        min: min_val,
                        max: max_val,
                        step: field_config['options']['step'],
                        values: [min_val, max_val],
                        change: function (e, ui) {
                            onNumericChange(e, ui);
                        },
                        slide: function (e, ui) {
                            var dt_cur_from = ui.values[0];
                            $('#liz-filter-field-min-numeric' + lizMap.cleanName(field_item)).val(dt_cur_from);
                            var dt_cur_to = ui.values[1];
                            $('#liz-filter-field-max-numeric' + lizMap.cleanName(field_item)).val(dt_cur_to);
                        }
                    });
                }

                $('#liz-filter-field-min-numeric' + lizMap.cleanName(field_item) + ', #liz-filter-field-max-numeric' + lizMap.cleanName(field_item)).change(function(){
                    // Filter the data. Only if the slider is not activated (if it is activated, it triggers the filter)
                    if(!hasSlider){
                        setFormFieldFilter(field_item);
                    }else{
                        // Change values of the slider
                        $("#liz-filter-slider-range"+ lizMap.cleanName(field_item)).slider(
                            "values",
                            [
                                $('#liz-filter-field-min-numeric' + lizMap.cleanName(field_item)).val(),
                                $('#liz-filter-field-max-numeric' + lizMap.cleanName(field_item)).val()
                            ]
                        );
                    }
                });
            }


            // text
            if( field_config['type'] == 'text' ){
                $('#liz-filter-field-text' + lizMap.cleanName(field_item)).change(function(){
                    // Filter the data
                    setFormFieldFilter(field_item);
                });
            }

            // Add event on reset buttons
            $('#liz-filter-box-' + lizMap.cleanName(field_item) + ' button.liz-filter-reset-field' ).click(function(){
                resetFormField($(this).val());
                setFormFilter();
            });

            // Add tooltip
            $('#liz-filter-box-' + lizMap.cleanName(field_item) + ' [title]').tooltip();

        }

        function getFeatureCount(filter){
            filter = typeof filter !== 'undefined' ?  filter : '';
            var sdata = {
                request: 'getFeatureCount',
                layerId: filterConfig.layerId,
                filter: filter
            };
            $.get(filterConfig.url, sdata, function(result){
                if( !result )
                    return false;
                if( 'status' in result && result['status'] == 'error' ){
                    console.log(result.title + ': ' + result.detail);
                    return false;
                }
                for(var a in result){
                    var feat = result[a];
                    var nb = feat['c'];
                    try{
                        nb = (new Intl.NumberFormat()).format(nb);
                    } catch(error) {
                        nb = feat['c'];
                    }
                    $('#liz-filter-item-layer-total-count').html(nb);
                }

            }, 'json');
        }

        function setZoomExtent(filter){
            filter = typeof filter !== 'undefined' ?  filter : '';

            // Get map projection and layer extent
            var mapProjection = lizMap.map.getProjection();
            if(mapProjection == 'EPSG:900913')
                mapProjection = 'EPSG:3857';

            if(!filter){
                // Use layer extent
                var itemConfig = lizMap.config.layers[filterConfig.layername];
                if('bbox' in itemConfig){
                    var lex = itemConfig['bbox'][mapProjection]['bbox'];
                    var extent = lex[0] + ',' + lex[1] + ',' + lex[2] + ',' + lex[3];
                    $('#liz-filter-zoom').val(extent);
                }
                return false;
            }

            // If a filter is set, request the extent with filter
            var sdata = {
                request: 'getExtent',
                layerId: filterConfig.layerId,
                filter: filter,
                crs: mapProjection
            };
            $.get(filterConfig.url, sdata, function(result){
                if( !result )
                    return false;
                if( 'status' in result && result['status'] == 'error' ){
                    console.log(result.title + ': ' + result.detail);
                    return false;
                }

                for(var a in result){
                    //BOX(33373 7527405.72750002,449056.961709125 7724585.66040861)
                    var bbox = result[a]['bbox'];
                    if(!bbox)
                        return false;
                    bbox = bbox.replace('BOX(', '');
                    bbox = bbox.replace(')', '');
                    var coords = bbox.split(',');
                    var a = coords[0].split(' ');
                    var b = coords[1].split(' ');
                    var extent = a[0] + ',' + a[1] + ',' + b[0] + ',' + b[1];
                    $('#liz-filter-zoom').val(extent);
                }

            }, 'json');
        }

        function zoomToFeatures(){
            var bounds = $('#liz-filter-zoom').val();
            var abounds = null;
            if(bounds){
                var abounds = bounds.split(',');
            }
            if( !bounds || abounds.length != 4 ){
                return false;
            }
            var extent = new OpenLayers.Bounds(abounds[0], abounds[1], abounds[2], abounds[3]);
            lizMap.map.zoomToExtent(extent);
            return false;
        }

        function removeFieldEvents(field_item){
            var container = lizMap.cleanName(field_item);
            var field_config = filterConfig.smartFieldsConfig[field_item];
        }

        // Launch SmartLayer feature
        launchSmartLayer();

        } // uicreated
    });


}();

var todo = `
* classe PHP pour
- compter les objets pour un filtre donné
- récupérer les valeurs distinctes pour les champs texte
- récupérer les min et max pour les champs numeric et date
- récupérer l'emprise pour pouvoir zoomer selon un filtre et ajouter l'option JS

* mettre à jour la table attributaire sur filtre si elle est affichée ? -> plutôt afficher un lien "Rafraîchir" en orange
* raffraîchir les graphiques lorsque le filtre est modifié, notamment lorsqu'on désactivé un champ ou tout le filtre
* gestion des valeurs NULL:
- soit proposer dans QGIS l'acceptation de IS NULL ou = NULL (en tout cas de NULL)
- soit depuis le JS, faire une requête qui récupère les ID via WFS à partir du filtre, puis déclencher le filtre Lizmap

* DATAVIZ
- bug de récupération des données vide si utilisation du bouton "Désactiver le filtre" -> ??????


`;
