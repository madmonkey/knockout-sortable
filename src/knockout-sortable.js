// knockout-sortable 0.11.0 | (c) 2015 Ryan Niemeyer |  http://www.opensource.org/licenses/mit-license
; (function (factory) {
    if (typeof define === "function" && define.amd) {
        // AMD anonymous module
        define(["knockout", "jquery", "jquery-ui/sortable", "jquery-ui/draggable"], factory);
    } else if (typeof require === "function" && typeof exports === "object" && typeof module === "object") {
        // CommonJS module
        var ko = require("knockout"),
            jQuery = require("jquery");
        require("jquery-ui/sortable");
        require("jquery-ui/draggable");
        factory(ko, jQuery);
    } else {
        // No module loader (plain <script> tag) - put directly in global namespace
        factory(window.ko, window.jQuery);
    }
})(function (ko, $) {
    var ITEMKEY = "ko_sortItem",
        INDEXKEY = "ko_sourceIndex",
        LISTKEY = "ko_sortList",
        PARENTKEY = "ko_parentList",
        DRAGKEY = "ko_dragItem",
        unwrap = ko.utils.unwrapObservable,
        dataGet = ko.utils.domData.get,
        dataSet = ko.utils.domData.set,
        version = $.ui && $.ui.version,
        //1.8.24 included a fix for how events were triggered in nested sortables. indexOf checks will fail if version starts with that value (0 vs. -1)
        hasNestedSortableFix = version && version.indexOf("1.6.") && version.indexOf("1.7.") && (version.indexOf("1.8.") || version === "1.8.24");

    //internal afterRender that adds meta-data to children
    var addMetaDataAfterRender = function (elements, data) {
        ko.utils.arrayForEach(elements, function (element) {
            if (element.nodeType === 1) {
                dataSet(element, ITEMKEY, data);
                dataSet(element, PARENTKEY, dataGet(element.parentNode, LISTKEY));
            }
        });
    };

    //prepare the proper options for the template binding
    var prepareTemplateOptions = function (valueAccessor, dataName) {
        var result = {},
            options = unwrap(valueAccessor()) || {},
            actualAfterRender;

        //build our options to pass to the template engine
        if (options.data) {
            result[dataName] = options.data;
            result.name = options.template;
        } else {
            result[dataName] = valueAccessor();
        }

        ko.utils.arrayForEach(["afterAdd", "afterRender", "as", "beforeRemove", "includeDestroyed", "templateEngine", "templateOptions", "nodes"], function (option) {
            if (options.hasOwnProperty(option)) {
                result[option] = options[option];
            } else if (ko.bindingHandlers.sortable.hasOwnProperty(option)) {
                result[option] = ko.bindingHandlers.sortable[option];
            }
        });

        //use an afterRender function to add meta-data
        if (dataName === "foreach") {
            if (result.afterRender) {
                //wrap the existing function, if it was passed
                actualAfterRender = result.afterRender;
                result.afterRender = function (element, data) {
                    addMetaDataAfterRender.call(data, element, data);
                    actualAfterRender.call(data, element, data);
                };
            } else {
                result.afterRender = addMetaDataAfterRender;
            }
        }

        //return options to pass to the template binding
        return result;
    };

    var updateIndexFromDestroyedItems = function (index, items) {
        var unwrapped = unwrap(items);

        if (unwrapped) {
            for (var i = 0; i < index; i++) {
                //add one for every destroyed item we find before the targetIndex in the target array
                if (unwrapped[i] && unwrap(unwrapped[i]._destroy)) {
                    index++;
                }
            }
        }

        return index;
    };

    //remove problematic leading/trailing whitespace from templates
    var stripTemplateWhitespace = function (element, name) {
        var templateSource,
            templateElement;

        //process named templates
        if (name) {
            templateElement = document.getElementById(name);
            if (templateElement) {
                templateSource = new ko.templateSources.domElement(templateElement);
                templateSource.text($.trim(templateSource.text()));
            }
        }
        else {
            //remove leading/trailing non-elements from anonymous templates
            $(element).contents().each(function () {
                if (this && this.nodeType !== 1) {
                    element.removeChild(this);
                }
            });
        }
    };

    //overide problematic jQuery sortable methods to support nested sortables
    var overrideContactContainers = function (event) {
        var i, j, dist, itemWithLeastDistance, posProperty, sizeProperty, cur, nearBottom, floating, axis,
			innermostContainer = null,
			innermostIndex = null;

        // get innermost container that intersects with item
        for (i = this.containers.length - 1; i >= 0; i--) {

            //Problem 1: Inspect the currentItem and evaluate if it is the intended container - without this check 
            // jquery ui rips element then attempts to insert into the removed element.
            // never consider a container that's located within the item itself
            if ($.contains(this.currentItem[0], this.containers[i].element[0]) || this.currentItem[0] === this.containers[i].element[0]) {
                continue;
            }

            if (this._intersectsWith(this.containers[i].containerCache)) {

                // if we've already found a container and it's more "inner" than this, then continue
                if (innermostContainer && $.contains(this.containers[i].element[0], innermostContainer.element[0])) {
                    continue;
                }

                innermostContainer = this.containers[i];
                innermostIndex = i;

            } else {
                // container doesn't intersect. trigger "out" event if necessary
                if (this.containers[i].containerCache.over) {
                    this.containers[i]._trigger("out", event, this._uiHash(this));
                    this.containers[i].containerCache.over = 0;
                }
            }

        }

        // if no intersecting containers found, return
        if (!innermostContainer) {
            return;
        }

        // move the item into the container if it's not there already
        if (this.containers.length === 1) {
            if (!this.containers[innermostIndex].containerCache.over) {
                this.containers[innermostIndex]._trigger("over", event, this._uiHash(this));
                this.containers[innermostIndex].containerCache.over = 1;
            }
        } else {

            //When entering a new container, we will find the item with the least distance and append our item near it
            dist = 10000;
            itemWithLeastDistance = null;
            floating = innermostContainer.floating || this._isFloating(this.currentItem);
            posProperty = floating ? "left" : "top";
            sizeProperty = floating ? "width" : "height";
            axis = floating ? "clientX" : "clientY";

            for (j = this.items.length - 1; j >= 0; j--) {
                if (!$.contains(this.containers[innermostIndex].element[0], this.items[j].item[0])) {
                    continue;
                }
                if (this.items[j].item[0] === this.currentItem[0]) {
                    continue;
                }

                cur = this.items[j].item.offset()[posProperty];
                nearBottom = false;
                if (event[axis] - cur > this.items[j][sizeProperty] / 2) {
                    nearBottom = true;
                }

                if (Math.abs(event[axis] - cur) < dist) {
                    dist = Math.abs(event[axis] - cur);
                    itemWithLeastDistance = this.items[j];
                    this.direction = nearBottom ? "up" : "down";
                }
            }

            //Check if dropOnEmpty is enabled
            if (!itemWithLeastDistance && !this.options.dropOnEmpty) {
                return;
            }

            if (this.currentContainer === this.containers[innermostIndex]) {
                if (!this.currentContainer.containerCache.over) {
                    this.containers[innermostIndex]._trigger("over", event, this._uiHash());
                    this.currentContainer.containerCache.over = 1;
                }
                return;
            }

            itemWithLeastDistance ? this._rearrange(event, itemWithLeastDistance, null, true) : this._rearrange(event, null, this.containers[innermostIndex].element, true);
            this._trigger("change", event, this._uiHash());
            this.containers[innermostIndex]._trigger("change", event, this._uiHash(this));
            this.currentContainer = this.containers[innermostIndex];

            //Update the placeholder
            this.options.placeholder.update(this.currentContainer, this.placeholder);

            this.containers[innermostIndex]._trigger("over", event, this._uiHash(this));
            this.containers[innermostIndex].containerCache.over = 1;
        }


    };

    var overideClear = function (event, noPropagation) {

        this.reverting = false;
        // We delay all events that have to be triggered to after the point where the placeholder has been removed and
        // everything else normalized again
        var i,
			delayedTriggers = [];

        // We first have to update the dom position of the actual currentItem
        // Note: don't do it if the current item is already removed (by a user), or it gets reappended (see #4088)
        if (!this._noFinalSort && this.currentItem.parent().length) {
            this.placeholder.before(this.currentItem);
        }
        this._noFinalSort = null;

        if (this.helper[0] === this.currentItem[0]) {
            for (i in this._storedCSS) {
                if (this._storedCSS[i] === "auto" || this._storedCSS[i] === "static") {
                    this._storedCSS[i] = "";
                }
            }
            this.currentItem.css(this._storedCSS).removeClass("ui-sortable-helper");
        } else {
            this.currentItem.show();
        }

        if (this.fromOutside && !noPropagation) {
            delayedTriggers.push(function (event) { this._trigger("receive", event, this._uiHash(this.fromOutside)); });
        }
        //Problem 2: Force the update event - not conditionally, to allow the binding handler to appropriately map underlying array.
        ////if((this.fromOutside || this.domPosition.prev !== this.currentItem.prev().not(".ui-sortable-helper")[0] || this.domPosition.parent !== this.currentItem.parent()[0]) && !noPropagation) {
        delayedTriggers.push(function (event) { this._trigger("update", event, this._uiHash()); }); //Trigger update callback if the DOM position has changed
        ////}

        // Check if the items Container has Changed and trigger appropriate
        // events.
        if (this !== this.currentContainer) {
            if (!noPropagation) {
                delayedTriggers.push(function (event) { this._trigger("remove", event, this._uiHash()); });
                delayedTriggers.push((function (c) { return function (event) { c._trigger("receive", event, this._uiHash(this)); }; }).call(this, this.currentContainer));
                delayedTriggers.push((function (c) { return function (event) { c._trigger("update", event, this._uiHash(this)); }; }).call(this, this.currentContainer));
            }
        }


        //Post events to containers
        function delayEvent(type, instance, container) {
            return function (event) {
                container._trigger(type, event, instance._uiHash(instance));
            };
        }
        for (i = this.containers.length - 1; i >= 0; i--) {
            if (!noPropagation) {
                delayedTriggers.push(delayEvent("deactivate", this, this.containers[i]));
            }
            if (this.containers[i].containerCache.over) {
                delayedTriggers.push(delayEvent("out", this, this.containers[i]));
                this.containers[i].containerCache.over = 0;
            }
        }

        //Do what was originally in plugins
        if (this.storedCursor) {
            this.document.find("body").css("cursor", this.storedCursor);
            this.storedStylesheet.remove();
        }
        if (this._storedOpacity) {
            this.helper.css("opacity", this._storedOpacity);
        }
        if (this._storedZIndex) {
            this.helper.css("zIndex", this._storedZIndex === "auto" ? "" : this._storedZIndex);
        }

        this.dragging = false;

        if (!noPropagation) {
            this._trigger("beforeStop", event, this._uiHash());
        }

        //$(this.placeholder[0]).remove(); would have been the jQuery way - unfortunately, it unbinds ALL events from the original node!
        this.placeholder[0].parentNode.removeChild(this.placeholder[0]);
        
        if (!this.cancelHelperRemoval) {
            if (this.helper[0] !== this.currentItem[0]) {
                this.helper.remove();
            }
            this.helper = null;
        }

        if (!noPropagation) {
            for (i = 0; i < delayedTriggers.length; i++) {
                delayedTriggers[i].call(this, event);
            } //Trigger all delayed events
            this._trigger("stop", event, this._uiHash());
        }

        this.fromOutside = false;
        return !this.cancelHelperRemoval;

    };

    //connect items with observableArrays
    ko.bindingHandlers.sortable = {
        init: function (element, valueAccessor, allBindingsAccessor, data, context) {

            var $element = $(element),
                value = unwrap(valueAccessor()) || {},
                templateOptions = prepareTemplateOptions(valueAccessor, "foreach"),
                sortable = {},
                startActual, updateActual;
            
            stripTemplateWhitespace(element, templateOptions.name);

            //build a new object that has the global options with overrides from the binding
            $.extend(true, sortable, ko.bindingHandlers.sortable);
            if (value.options && sortable.options) {
                ko.utils.extend(sortable.options, value.options);
                delete value.options;
            }
            ko.utils.extend(sortable, value);
            if (sortable.options.nestedSortable && sortable.options.nestedSortable == true) {
                $.ui.sortable.prototype._contactContainers = overrideContactContainers;
                $.ui.sortable.prototype._clear = overideClear;
            }
            //if allowDrop is an observable or a function, then execute it in a computed observable
            if (sortable.connectClass && (ko.isObservable(sortable.allowDrop) || typeof sortable.allowDrop == "function")) {
                ko.computed({
                    read: function () {
                        var value = unwrap(sortable.allowDrop),
                            shouldAdd = typeof value == "function" ? value.call(this, templateOptions.foreach) : value;
                        ko.utils.toggleDomNodeCssClass(element, sortable.connectClass, shouldAdd);
                    },
                    disposeWhenNodeIsRemoved: element
                }, this);
            } else {
                ko.utils.toggleDomNodeCssClass(element, sortable.connectClass, sortable.allowDrop);
            }

            //wrap the template binding
            ko.bindingHandlers.template.init(element, function () { return templateOptions; }, allBindingsAccessor, data, context);

            //keep a reference to start/update functions that might have been passed in
            startActual = sortable.options.start;
            updateActual = sortable.options.update;

            //initialize sortable binding after template binding has rendered in update function
            var createTimeout = setTimeout(function () {
                var dragItem;
                $element.sortable(ko.utils.extend(sortable.options, {
                    start: function (event, ui) {
                        //track original index
                        var el = ui.item[0];
                        dataSet(el, INDEXKEY, ko.utils.arrayIndexOf(ui.item.parent().children(), el));

                        //make sure that fields have a chance to update model
                        ui.item.find("input:focus").change();
                        if (startActual) {
                            startActual.apply(this, arguments);
                        }
                    },
                    receive: function (event, ui) {
                        dragItem = dataGet(ui.item[0], DRAGKEY);
                        if (dragItem) {
                            //copy the model item, if a clone option is provided
                            if (dragItem.clone) {
                                dragItem = dragItem.clone();
                            }

                            //configure a handler to potentially manipulate item before drop
                            if (sortable.dragged) {
                                dragItem = sortable.dragged.call(this, dragItem, event, ui) || dragItem;
                            }
                        }
                        //event.stopImmediatePropagation();
                    },
                    update: function (event, ui) {
                        var sourceParent, targetParent, sourceIndex, targetIndex, arg,
                            el = ui.item[0],
                            parentEl = ui.item.parent()[0],
                            item = dataGet(el, ITEMKEY) || dragItem;
                        //event.stopImmediatePropagation();
                        dragItem = null;
                        //identify parents
                        sourceParent = null;
                        sourceIndex = -1;
                        targetIndex = -1;
                        if (el) {
                            sourceParent = dataGet(el, PARENTKEY);
                            sourceIndex = dataGet(el, INDEXKEY);
                        }
                        targetParent = null;
                        if (el.parentNode) {
                            targetParent = dataGet(el.parentNode, LISTKEY);
                        }
                        targetIndex = ko.utils.arrayIndexOf(ui.item.parent().children(), el);
                        
                        //make sure that moves only run once, as update fires on multiple containers
                        if (item && (this === parentEl) || (!hasNestedSortableFix && $.contains(this, parentEl))) 
                        {
                            //take destroyed items into consideration
                            if (!templateOptions.includeDestroyed)
                            {
                                sourceIndex = updateIndexFromDestroyedItems(sourceIndex, sourceParent);
                                targetIndex = updateIndexFromDestroyedItems(targetIndex, targetParent);
                            }

                            //build up args for the callbacks
                            if (sortable.beforeMove || sortable.afterMove) {
                                arg = {
                                    item: item,
                                    sourceParent: sourceParent,
                                    sourceParentNode: sourceParent && ui.sender || el.parentNode,
                                    sourceIndex: sourceIndex,
                                    targetParent: targetParent,
                                    targetIndex: targetIndex,
                                    cancelDrop: false
                                };

                                //execute the configured callback prior to actually moving items
                                if (sortable.beforeMove) {
                                    sortable.beforeMove.call(this, arg, event, ui);
                                }
                            }

                            //call cancel on the correct list, so KO can take care of DOM manipulation
                            if (sourceParent) {
                                $(sourceParent === targetParent || targetParent && sourceParent._id ===targetParent._id ? this : ui.sender || this).sortable("cancel");
                            }
                            //    for a draggable item just remove the element
                            else {
                                $(el).remove();
                            }

                            //if beforeMove told us to cancel, then we are done
                            if (arg && arg.cancelDrop) {
                                return;
                            }

                            //do the actual move
                            if (targetIndex >= 0) {
                                if (sourceParent) {
                                    sourceParent.splice(sourceIndex, 1);
                                    //if using deferred updates plugin, force updates
                                    if (ko.processAllDeferredBindingUpdates) {
                                        ko.processAllDeferredBindingUpdates();
                                    }
                                }
                                ko.utils.arrayFirst(targetParent(), function (arrayItem) {
                                    if (ko.toJSON(arrayItem) == ko.toJSON(item))
                                    {
                                        targetParent.remove(arrayItem);
                                        $(el).remove();
                                    }
                                });
                                
                                setTimeout(function () {
                                    targetParent.splice(targetIndex, 0, item);
                                }, 100);
                            }

                            //rendering is handled by manipulating the observableArray; ignore dropped element
                            dataSet(el, ITEMKEY, null);
                            
                            //if using deferred updates plugin, force updates
                            if (ko.processAllDeferredBindingUpdates) {
                                ko.processAllDeferredBindingUpdates();
                            }

                            //allow binding to accept a function to execute after moving the item
                            if (sortable.afterMove) {
                                sortable.afterMove.call(this, arg, event, ui);
                            }
                        }
                        else { //Problem 3: you still actually have work to do - the if *check* up above does not update under all conditions
                            if (sourceParent) {
                                $(sourceParent === targetParent || targetParent && sourceParent._id === targetParent._id ? this : ui.sender || this).sortable("cancel");
                            }
                                //    for a draggable item just remove the element
                            else {
                                $(el).remove();
                            }
                            if (targetIndex >= 0) {
                                if (sourceParent) {
                                    sourceParent.splice(sourceIndex, 1);
                                    //if using deferred updates plugin, force updates
                                    if (ko.processAllDeferredBindingUpdates) {
                                        ko.processAllDeferredBindingUpdates();
                                    }
                                }
                                ko.utils.arrayFirst(targetParent(), function (arrayItem) {
                                    if (ko.toJSON(arrayItem) == ko.toJSON(item)) {
                                        targetParent.remove(arrayItem);
                                        $(el).remove();
                                    }
                                });

                                setTimeout(function () {
                                    targetParent.splice(targetIndex, 0, item);
                                }, 100);

                            }

                            //rendering is handled by manipulating the observableArray; ignore dropped element
                            dataSet(el, ITEMKEY, null);

                    }
                        if (updateActual) {
                            updateActual.apply(this, arguments);
                        }
                    },
                    connectWith: sortable.connectClass ? "." + sortable.connectClass : false
                }));

                //handle enabling/disabling sorting
                if (sortable.isEnabled !== undefined) {
                    ko.computed({
                        read: function () {
                            $element.sortable(unwrap(sortable.isEnabled) ? "enable" : "disable");
                        },
                        disposeWhenNodeIsRemoved: element
                    });
                }
            }, 0);
            
            //handle disposal
            ko.utils.domNodeDisposal.addDisposeCallback(element, function () {
                //only call destroy if sortable has been created
                if ($element.data("ui-sortable") || $element.data("sortable")) {
                    $element.sortable("destroy");
                }

                ko.utils.toggleDomNodeCssClass(element, sortable.connectClass, false);

                //do not create the sortable if the element has been removed from DOM
                clearTimeout(createTimeout);
            });

            return { 'controlsDescendantBindings': true };
        },
        update: function (element, valueAccessor, allBindingsAccessor, data, context) {
            var templateOptions = prepareTemplateOptions(valueAccessor, "foreach");

            //attach meta-data
            dataSet(element, LISTKEY, templateOptions.foreach);

            //call template binding's update with correct options
            ko.bindingHandlers.template.update(element, function () { return templateOptions; }, allBindingsAccessor, data, context);
        },
        connectClass: 'ko_container',
        allowDrop: true,
        afterMove: null,
        beforeMove: null,
        options: {}
    };

    //create a draggable that is appropriate for dropping into a sortable
    ko.bindingHandlers.draggable = {
        init: function (element, valueAccessor, allBindingsAccessor, data, context) {
            var value = unwrap(valueAccessor()) || {},
                options = value.options || {},
                draggableOptions = ko.utils.extend({}, ko.bindingHandlers.draggable.options),
                templateOptions = prepareTemplateOptions(valueAccessor, "data"),
                connectClass = value.connectClass || ko.bindingHandlers.draggable.connectClass,
                isEnabled = value.isEnabled !== undefined ? value.isEnabled : ko.bindingHandlers.draggable.isEnabled;

            value = "data" in value ? value.data : value;
            element._contactContainers = function (event) { console.log('hi'); };
            //set meta-data
            dataSet(element, DRAGKEY, value);

            //override global options with override options passed in
            ko.utils.extend(draggableOptions, options);

            //setup connection to a sortable
            draggableOptions.connectToSortable = connectClass ? "." + connectClass : false;

            //initialize draggable
            $(element).draggable(draggableOptions);
            
            //handle enabling/disabling sorting
            if (isEnabled !== undefined) {
                ko.computed({
                    read: function () {
                        $(element).draggable(unwrap(isEnabled) ? "enable" : "disable");
                    },
                    disposeWhenNodeIsRemoved: element
                });
            }

            //handle disposal
            ko.utils.domNodeDisposal.addDisposeCallback(element, function () {
                $(element).draggable("destroy");
            });

            return ko.bindingHandlers.template.init(element, function () { return templateOptions; }, allBindingsAccessor, data, context);
        },
        update: function (element, valueAccessor, allBindingsAccessor, data, context) {
            var templateOptions = prepareTemplateOptions(valueAccessor, "data");

            return ko.bindingHandlers.template.update(element, function () { return templateOptions; }, allBindingsAccessor, data, context);
        },
        connectClass: ko.bindingHandlers.sortable.connectClass,
        options: {
            helper: "clone"
        }
    };
    
});