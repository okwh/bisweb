/*  LICENSE
 
 _This file is Copyright 2018 by the Image Processing and Analysis Group (BioImage Suite Team). Dept. of Radiology & Biomedical Imaging, Yale School of Medicine._
 
 BioImage Suite Web is licensed under the Apache License, Version 2.0 (the "License");
 
 - you may not use this software except in compliance with the License.
 - You may obtain a copy of the License at [http://www.apache.org/licenses/LICENSE-2.0](http://www.apache.org/licenses/LICENSE-2.0)
 
 __Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.__
 
 ENDLICENSE */

/* global window,setTimeout */
"use strict";

/**
 * @file A Broswer module. Contains {@link WebFileUtil}.
 * @author Xenios Papademetris
 * @version 1.0
 */

const $=require('jquery');
const webutil=require('bis_webutil');
const bisweb_dropbox=require('bisweb_simpledropbox');
const bisweb_onedrive=require('bisweb_simpleonedrive');
const bisweb_googledrive=require('bisweb_drivemodule');
const genericio=require('bis_genericio');
const userPreferences = require('bisweb_userpreferences.js');
const bisdbase = require('bisweb_dbase');
const keystore=require('bis_keystore');
const dkey=keystore.DropboxAppKey || "";
const gkey=keystore.GoogleDriveKey || "";
const mkey=keystore.OneDriveKey || "";
const userPreferencesLoaded = userPreferences.webLoadUserPreferences(bisdbase);



// Initial mode
let fileMode='local';


const webfileutils = {

    needModes : function() {
        if (dkey.length>0 || gkey.length>0 || mkey.length>0)
            return true;
        return false;
    },

    getMode: function() {
        return fileMode;
    },
    
    getModeList : function() {
        let s=[ { value: "local", text: "Local FileSystem" }];

        if (dkey.length>1)
            s.push({ value: "dropbox", text: "Dropbox" });
        if (gkey.length>1) 
            s.push({ value: "googledrive", text: "Google Drive" });
        if (mkey.length>1) 
            s.push({ value: "onedrive", text: "Microsoft OneDrive" });

        return s;
    },
    
    setMode : function(m='') {

        m=m || 'local';
        if (m==="dropbox" && dkey!=="")
            fileMode="dropbox";
        else if (m==="googledrive" && gkey!=="")
            fileMode="googledrive";
        else if (m==="onedrive" && mkey!=="")
            fileMode="onedrive";
        else
            fileMode="local";

        userPreferences.setItem('filesource',fileMode);
        userPreferences.storeUserPreferences();
    },

    
    /** function to create a hidden input type="file" button and add it to body
     * @alias WebFileUtil.createHiddenInputFile
     * @param {function} callback - callback to call
     * @param {string} accept - List of file types to accept as a comma-separated string e.g. ".ljson,.land"
     * @param {Boolean} attach - if true attach to body, else leave transient
     * @returns {JQueryElement} 
     */
    createHiddenInputFile: function (accept, callback,attach=true) {

        /*if { simpemode === false } {
          return dosomethingelse(accept,callback);*/
        
        accept = accept || "";
        if (accept === "NII")
            accept = '.nii,.nii.gz,.gz,.tiff';

        var loadelement = $('<input type="file" style="visibility: hidden;" accept="' + accept + '"/>');
        if (attach)
            $('body').append(loadelement);
        
        loadelement[0].addEventListener('change', function (e) {
            e.stopPropagation();
            e.preventDefault();
            callback(e.target.files[0]);
        });
        return loadelement;
    },
    
    /** electron file callback function
     * @alias WebFileUtil.electronFileCallback
     * @param {object} opts - the file options object 
     * @param {string} opts.title - if in file mode and file set the title of the file dialog
     * @param {boolean} opts.save - if in file mode and file determine load or save
     * @param {string} opts.defaultpath - if in file mode and file use this as original filename
     * @param {string} opts.filter - if in file mode and file use this to filter file style
     * @param {string} opts.suffix - used to create filter if present (simplified version)
     * @param {function} callback - callback to call when done
     */
    electronFileCallback: function (fileopts, callback) {
        fileopts = fileopts || {};
        fileopts.save = fileopts.save || false;
        fileopts.title = fileopts.title || 'Specify filename';
        fileopts.defaultpath = fileopts.defaultpath || '';

        let suffix = fileopts.suffix || '';
        if (suffix === "NII" || fileopts.filters === "NII")
            fileopts.filters = [
                { name: 'NIFTI Images', extensions: ['nii.gz', 'nii'] },
                { name: 'All Files', extensions: [ "*"]},
            ];
        if (suffix === "DIRECTORY")
            fileopts.filters = "DIRECTORY";
        
        if (fileopts.defaultpath==='') {
            if (fileopts.initialCallback)
                fileopts.defaultpath=fileopts.initialCallback() || '';
        }
            
        
        fileopts.filters = fileopts.filters ||
            [{ name: 'All Files', extensions: ['*'] }];

        if (fileopts.filters === "NII")
            fileopts.filters = [
                { name: 'NIFTI Images', extensions: ['nii.gz', 'nii'] },
                { name: 'All Files', extensions: ['*'] },
            ];

        var cmd = window.BISELECTRON.dialog.showSaveDialog;
        if (!fileopts.save)
            cmd = window.BISELECTRON.dialog.showOpenDialog;

        if (fileopts.filters === "DIRECTORY") {
            cmd(null, {
                title: fileopts.title,
                defaultPath: fileopts.defaultpath,
                properties: ["openDirectory"],
            }, function (filename) {
                if (filename) {
                    return callback(filename + '');
                }
            });
        } else {
            cmd(null, {
                title: fileopts.title,
                defaultPath: fileopts.defaultpath,
                filters: fileopts.filters,
            }, function (filename) {
                if (filename) {
                    return callback(filename + '');
                }
            });
        }
    },




    /** web file callback function
     * @alias WebFileUtil.webFileCallback
     * @param {object} opts - the callback options object
     * @param {string} opts.title - if in file mode and web set the title of the file dialog
     * @param {boolean} opts.save - if in file mode and web determine load or save
     * @param {string} opts.defaultpath - if in file mode and web use this as original filename
     * @param {string} opts.suffix - if in file mode and web use this to filter web style
     * @param {function} callback - callback to call when done
     */
    webFileCallback: function (fileopts, callback) {

        let suffix = fileopts.suffix || '';
        if (suffix === "NII")
            suffix = '.nii,.nii.gz,.gz,.tiff';
        

        if (fileopts.save) {
            callback({});
            return;
        }


        // -------- load -----------
        
        if (fileMode==='dropbox') { 
            fileopts.suffix=suffix;
            return bisweb_dropbox.pickReadFile(fileopts,callback);
        }
        
        if (fileMode==='onedrive') { 
            fileopts.suffix=suffix;
            return bisweb_onedrive.pickReadFile(fileopts,callback);
        }
        
        
        if (fileMode==="googledrive") {
            bisweb_googledrive.create().then( () => {
                bisweb_googledrive.pickReadFile("").then(
                    (obj) => {
                        callback(obj[0]);
                    }
                ).catch((e) => { console.log('Error in Google drive', e); });
            }).catch( (e) => { console.log(e);
                               webutil.createAlert("Failed to intitialize google drive connection", true);
                             });
            return;
        }
        
        
        let loadelement = $('<input type="file" style="visibility: hidden;" accept="' + suffix + '" />');
        loadelement[0].addEventListener('change', function (f) {
            f.stopPropagation();
            f.preventDefault();
            callback(f.target.files[0]);
        });
        loadelement[0].click();
    },


    /** Create File Callback 
     * @alias WebFileUtil.attachFileCallback
     * @param {JQueryElement} button -- the element to attach the callback to
     * @param {object} fileopts - the file dialog options object (in file style)
     * @param {string}  fileopts.title  - in file: dialog title
     * @param {boolean} fileopts.save -  in file determine load or save
     * @param {string}  fileopts.defaultpath -  use this as original filename
     * @param {string}  fileopts.filter - use this as filter (if in electron)
     * @param {string}  fileopts.suffix - List of file types to accept as a comma-separated string e.g. ".ljson,.land" (simplified version filter)
     */
    attachFileCallback : function(button,callback,fileopts={}) {

        fileopts = fileopts || {};
        fileopts.save = fileopts.save || false;
        
        const that = this;
        
        if (webutil.inElectronApp()) {
            
            button.click(function(e) {
                setTimeout( () => {
                    e.stopPropagation();
                    e.preventDefault();  
                    that.electronFileCallback(fileopts, callback);
                },1);
            });
        } else {
            button.click(function(e) {
                setTimeout( () => {
                    e.stopPropagation();
                    e.preventDefault();
                    that.webFileCallback(fileopts, callback);
                },1);
            });
        }
    },

    
    /** 
     * function that creates button using Jquery/Bootstrap (for styling) & a hidden
     * input type="file" element to load a file. Calls WebFileUtil.createbutton for most things
     * @alias WebFileUtil.createFileButton
     * @param {object} opts - the options object.
     * @param {string} opts.name - the name of the button.
     * @param {string} opts.parent - the parent element. If specified the new button will be appended to it.
     * @param {object} opts.css - if specified set additional css styling info (Jquery .css command, object)
     * @param {string} opts.type - type of button (for bootstrap styling). One of "default", "primary", "success", "info", "warning", "danger", "link"
     * @param {function} opts.callback - if specified adds this is a callback ``on click''. The event (e) is passed as argument.
     * @param {string} opts.tooltip - string to use for tooltip
     * @param {string} opts.position - position of tooltip (one of top,bottom,left,right)
     * @returns {JQueryElement} 
     */
    createFileButton: function (opts, fileopts={}) {
        
        let finalcallback = opts.callback || null;
        if (finalcallback !== null && typeof finalcallback === "function") {
            opts.callback = finalcallback;
        } else {
            throw (new Error('create file button needs a non-null callback'));
        }
        
        opts.callback=null;
        let but= webutil.createbutton(opts);
        this.attachFileCallback(but,finalcallback,fileopts);
        return but;
    },


    /** create  drop down menu item (i.e. a single button)
     * @param {JQueryElement} parent - the parent to add this to
     * @param {string} name - the menu name (if '') adds separator
     * @param {function} callback - the callback for item
     * @param {string} suffix - if not empty then this creates a hidden file menu that is
     * @param {object} opts - the electron options object -- used if in electron
     * @param {string} opts.title - if in file mode and electron set the title of the file dialog
     * @param {boolean} opts.save - if in file mode and electron determine load or save
     * @param {string} opts.defaultpath - if in file mode and electron use this as original filename
     * @param {string} opts.filter - if in file mode and electron use this to filter electron style
     * @param {string} css - styling info for link element
     * activated by pressing this menu
     * @alias WebFileUtil.createMenuItem
     * @returns {JQueryElement} -- the  element
     */
    createFileMenuItem: function (parent, name="", callback=null, fileopts={},css='') {

        let style='';
        if (css.length>1)
            style=` style="${css}"`;
        
        let menuitem = $(`<li><a href="#" ${style}>${name}</a></li>`);
        parent.append(menuitem);
        webutil.disableDrag(menuitem,true);
        this.attachFileCallback(menuitem,callback,fileopts);
        return menuitem;
    },
    // ------------------------------------------------------------------------

    createDropdownFileItem : function (dropdown,name,callback,fileopts) {

        return this.createFileMenuItem(dropdown,name,callback,fileopts,
                                       "background-color: #303030; color: #ffffff; font-size:13px; margin-bottom: 2px");
    },

    // -------------------------------------------------------------------------
    createFileSourceSelector : function(bmenu,name="Set File Source",separator=true) {

        const self=this;
        
        let fn=function() {
            userPreferencesLoaded.then(() => {
                let initial=userPreferences.getItem('filesource') || 'local';
                webutil.createRadioSelectModalPromise(`<H4>Select file source</H4><HR>`,
                                                      "Close",
                                                      initial,
                                                      self.getModeList()
                                                     ).then( (m) => {
                                                         self.setMode(m);
                                                     }).catch((e) => {
                                                         console.log('Error ', e);
                                                     });
            });
        };
        
        if (!webutil.inElectronApp() && this.needModes()) {
            if (separator)
                webutil.createMenuItem(bmenu,'');
            webutil.createMenuItem(bmenu, name, fn);
        }
    },

    // ------------------

    cloudSave : function(blob,filename,callback=null) {

        if (fileMode==='onedrive') {
            let objectURL = URL.createObjectURL(blob);
            bisweb_onedrive.pickWriteFile(objectURL,filename,callback);
            return true;
        }
        
        return false;
    },
    
};


// Link into genericio -- once it works
// genericio.setCloudSaveFunction(webfileutils.cloudSave);


userPreferencesLoaded.then(() => {
    let f=userPreferences.getItem('filesource') || 'local';
    console.log('Initial File Source=',f);
    webfileutils.setMode(f);
});

module.exports=webfileutils;

                          
