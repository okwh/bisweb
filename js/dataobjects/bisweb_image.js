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

"use strict";

/**
 * @file Browser/Node.js module. Contains {@link BisWeb_Image}.
 * @author Xenios Papademetris
 * @version 1.0
 */

const BisWebDataObject=require('bisweb_dataobject');
const BisWebMatrix=require('bisweb_matrix');
const biswasm=require('bis_wasmutils.js');
const util=require('bis_util');
const userPreferences = require('bisweb_userpreferences.js');
const bisgenericio=require("bis_genericio");
const tiff=require('tiff2');
const bisheader = require("bis_header.js");
const simplemat=require('bis_simplemat');



/** Class representing a medical image */
class BisWebImage extends BisWebDataObject { 
    
    /**
       Initialize the image
    */
    constructor() {
        super();
        this.jsonformatname='BisImage';
        this.internal = { 
            dimensions : [ 0, 0, 0, 0 ,0 ],
            offsets    : [ 1,1,1,1,1 ],
            range      : [ 0,0 ],
            spacing   : [ 1.0 ,1.0,1.0,1.0,1.0 ],
            imgdata   : null,
            _rawdata  : null,
            rawsize   : 0,
            volsize   : 0,
            singlebuffer : null,
            forcedorientationchange : false,
            orient    : {
                IJKToRAS : null,
                axis     : [ 0, 1, 2 ],
                invaxis  : [ 0, 1, 2 ],
                flip     : [ 0,0,0 ],
                invflip  : [ 0,0,0 ],
                name     : "RAS"
            },
            header    : {} ,
            imginfo   : { 
                type     : Uint8Array,
                size     : 1,
                name     : 'uchar'
            }
        };
        this.debug=false;
        this.extensions=".nii.gz";
    }

    // ---- Get Object Information -------------------------------------------------
    /** Returns the type of the object as a string
     * @returns{String} - the type of the object (e.g. image,matrix ...)
     */
    getObjectType() {
        return "image";
    }

    /** Returns the default extensions
     * @returns{String} - ".nii.gz"
     */
    getExtension() {
        return ".nii.gz";
    }

    /** returns the image type
     * @returns {string} type
     */
    getImageType() {
        return this.internal.imginfo.name;
    }
    
    /** returns a textual description of the object for GUIs etc.
     * @returns {string} description
     */
    getDescription() {
        let sp=[0,0,0];
        for (let ia=0;ia<this.internal.spacing.length;ia++) {
            sp[ia]=util.scaledround(this.internal.spacing[ia],1000);
        }
        let b=this.internal.imginfo.name;
        return this.filename+" dim="+this.internal.dimensions+", sp="+sp+" orient=" + this.internal.orient.name+" type="+b;

    }

    /** compute hash 
     * @returns {String} - hash string identifying the object
     */
    computeHash() {
        return util.SHA256(this.getRawData());
    }

    /** returns the memory used in bytes by this object 
     * @returns {number} -- the size or 0 if not implemented or small
     */
    getMemorySize() {
        return this.getRawData().length;
    }


    // ---- Load and Save, Serialize and Deserialize to JSON -------------------------------------------------
    /**
     * Load an image from a filename or file object
     * @param {fobj} - If in browser this is a File object, if in node.js this is the filename!
     * @param {String} forceorient - if true or "RAS" force input image to be repermuted to Axial RAS. if "LPS" force LPS. Else do nothing
     * @return {Promise} a promise that is fuilfilled when the image is loaded
     */
    load(fobj,forceorient) {

        forceorient = userPreferences.sanitizeOrientationOnLoad(forceorient ||  userPreferences.getImageOrientationOnLoad());
        if (this.debug) {
            console.log('..... forceorient in readbinary=',forceorient);
        }
        const self=this;

        return new Promise( (resolve,reject) => {
            bisgenericio.read(fobj,true).then( function(obj) {
                self.initialize();
                let ext=obj.filename.split('.').pop().toLowerCase();
                if (ext==="tif" || ext==="tiff")  {
                    if (obj.data.constructor.name === "Uint8Array")
                        self.parseTIFF(obj.data.buffer,obj.filename,forceorient);
                    else
                        self.parseTIFF(obj.data,obj.filename,forceorient);
                    
                    self.commentlist=[ 'read from tiff '+fobj ];                                        
                    self.internal.header.setExtensionsFromArray(self.commentlist);
                } else {
                    try {
                        self.parseNII(obj.data.buffer,forceorient);
                    } catch(e) {
                        reject('Failed to load from '+fobj + '('+e+')');
                        reject(e);
                    }
                }

                self.setFilename(bisgenericio.getFixedLoadFileName(fobj));
                
                console.log('++++\t loaded image from '+fobj+'. Dim=',self.getDimensions(),self.getOrientationName()+' spa='+self.getSpacing() + ' type='+self.getDataType());
                if (self.internal.forcedorientationchange) {
                    console.log('++++ \t **** forced image orientation to ',forceorient,' to match user preferences');
                    self.commentlist.push({ "Operation" : "On Load from "+fobj+" reoriented to "+self.internal.orient.name+" to match user preferences."});
                    self.internal.header.setExtensionsFromArray(self.commentlist);
                }
                
                resolve();
            }).catch( (e)=> { reject(e); });
        });
    }

    /** saves an image to a filename. This is a messy function depending on whether one is in
     * node, electronr browser but it does the job
     * @param {string} filename - the filename to save to. If in broswer it will pop up a FileDialog
     * @return {Promise} a promise that is fuilfilled when the image is saved
     */
    save(fobj) {

        const self=this;
        let c=self.serializeToNII();
        fobj=bisgenericio.getFixedSaveFileName(fobj,this.filename);
        return bisgenericio.write(fobj,c,true);
    }

    /** serializes image to a javascript dictionary object
        @returns {Object} dictionary containing all key elements
    */
    serializeToDictionary() {

        let obj= super.serializeToDictionary();
        let arr=this.serializeToNII();
        obj.data=bisgenericio.tozbase64(arr);
        return obj;
    }


    /** parses from Dictionary Object  
     * @param {Object} obj -- dictionary object
     * @returns {Boolean} true if OK
     */
    parseFromDictionary(obj,forceorientin='') {
        this.initialize();
        super.parseFromDictionary(obj);
        let forceorient = forceorientin || '';
        let arr=bisgenericio.fromzbase64(obj.data);
        this.parseNII(arr.buffer,forceorient);
        return true;
    }


    // ---- Interface to Web Assembly Code ----------------------------------------------------
    /** serializes an image to a WASM array
     * @param {EmscriptenModule} Module - the emscripten Module object
     * @returns {Pointer}  -- pointer biswasm serialized array
     */
    serializeWasm(Module) {

        let arr=this.getImageData();
        let dim=this.getDimensions();
        let spa=this.getSpacing();
        return biswasm.packStructure(Module,arr,dim,spa);
    }

    /** deserializes an image from WASM array (with an optional bis_image second input to 
        help with header input)
        * @param {EmscriptenModule} Module - the emscripten Module object
        * @param {Pointer} wasmarr - the unsined char wasm object
        * @param {BisWebImage} inputimage - the input ``information'' or ``reference'' image (optional)
        */
    deserializeWasm(Module,wasmarr,baseimage=0) {

        const internal=this.internal;
        baseimage = baseimage || 0;
        let wasmobj=biswasm.unpackStructure(Module,wasmarr,true);
        if (wasmobj.magic_type===0) {
            console.log('Bad wasmobj in deserializing Image (bis_image.js line 1089)');
            return 0;
        }

        let dataptr=wasmobj.dataptr+56;
        this.initialize();
        
        let nifti_info=internal.header.getniftitype(wasmobj.datatype);
        
        let opts = {
            type : nifti_info[0],
            numframes :  wasmobj.dimensions[3] ,
            numcomponentes:  wasmobj.dimensions[4] ,
            dimensions :  [ wasmobj.dimensions[0], wasmobj.dimensions[1], wasmobj.dimensions[2] ],
            spacing :  [ wasmobj.spacing[0], wasmobj.spacing[1], wasmobj.spacing[2] ],
        };
            
        if (baseimage !==0 ) {
            this.cloneImage(baseimage,opts);
            this.setCommentList(baseimage.getCommentList());
        } else {
            this.createImage(opts);
        }

        
        let dataView=biswasm.get_array_view(Module, nifti_info[1],dataptr,internal.volsize);
        for (let k=0;k<internal.volsize;k++)
            internal.imgdata[k]=dataView[k];
        
        return 1;
    }

    // ---- Testing utility ----------------------------------------------------
    /** compares an image with a peer object of the same class and returns true if similar or false if different 
     * @param{BisWebDataObject} other - the other object
     * @param{String} method - the comparison method one of maxabs,ssd,cc etc.
     * @param{Number} threshold - the threshold to use for comparison
     * @returns{Object} - { testresult: true or false, value: comparison value, metric: metric name } 
     */
    compareWithOther(other,method="maxabs",threshold=0.01) {

        let out = {
            testresult : false,
            value : null,
            metric : "maxabs"
        };

        if (other.constructor.name !== this.constructor.name) 
            return out;
        
        
        console.log('....\t comparing images:',this.getDimensions(),other.getDimensions());
        if (method==='cc') {
            out.value=util.computeCC(this.getImageData(),other.getImageData());
            out.metric='cc';
            if (out.value > threshold) {
                out.testresult=true;
            }
        } else {
            out.value=this.maxabsdiff(other);
            out.metric='maxabs';
            if (out.value < threshold)
                out.testresult=true;
        }
        return out;
    }


    // --------------- Object Specific Methods ---------------------------------------------------------------

    /** Creates the image */
    initialize() {
        this.internal.header=new bisheader();
        this.internal.header.initializenifti();
    }


    /** computes the intensity range of the image (to be returned by getIntensityRange).
     * call this if the image has been manipulated. One day we will add timestamps.
     */
    computeIntensityRange() {

        this.internal.range = [ 0,0];
        if (this.internal.imgdata===null)
            return;
        
        let l=this.internal.imgdata.length;
        if (l===0)
            return;
        this.internal.range = [ this.internal.imgdata[0], this.internal.imgdata[0] ];
        for (let m=1;m<l;m++) {
            let v=this.internal.imgdata[m];
            if (v>this.internal.range[1])
                this.internal.range[1]=v;
            else if (v<this.internal.range[0])
                this.internal.range[0]=v;
        }
    }
    
    /** get intensity range as a 2-array [ min,max]
     * @returns {array} 
     */
    getIntensityRange() {
        if (this.internal.range[0] === this.internal.range[1])
            this.computeIntensityRange();
        return this.internal.range.slice(0);
    }

    /** get intensity value at coords
     * @param {coords} - array of size 4 x,y,z,t
     * @returns {number} - intensity
     */
    getVoxel(coords) {
        const internal=this.internal;
        let index=util.range(coords[0]+
                             coords[1]*internal.offsets[1]+
                             coords[2]*internal.offsets[2]+
                             coords[3]*internal.offsets[3],0,internal.volsize-1);
        return internal.imgdata[index];
    }

    /** getRawPixel Data
        @return {TypedArray} -- the raw image data */
    getImageData() { return  this.internal.imgdata; }

    /** getRawData
        @return {TypedArray} -- the raw image data */
    getRawData() { return this.internal._rawdata;}

    /** get Image Dimensions 
     * @return {array} image dimensions */
    getDimensions() { return this.internal.dimensions.slice(0); }

    /** get image bounds as a 6-array [ 0,width-1,0,height-1,0,depth-1]
     * @param {number} margin - default 0. If not zero then bounds are shrunk by margin all around
     * @returns {array} 
     */
    getBounds(margin)  {
        margin = margin | 0; 
        return [ margin,this.internal.dimensions[0]-(1+margin),
                 margin,this.internal.dimensions[1]-(1+margin),
                 margin,this.internal.dimensions[2]-(1+margin)];
    }

    /** get Image Size (width,height,depth) 
     * @return {array} first 3 image dimensions */
    getImageSize() {
        return [ this.internal.dimensions[0]*this.internal.spacing[0],
                 this.internal.dimensions[1]*this.internal.spacing[1],
                 this.internal.dimensions[2]*this.internal.spacing[2]];
    }
    
    /** get Image Spacing 
     * @return {array} image spacing */
    getSpacing() { return this.internal.spacing.slice(0);}



    /** clones an image with same changes ... this is not a copy but modifying this image to have similar properties (type, header, etc.) to input
     * @param {BisWebImage} inputimage - the input ``information'' or ``reference'' image.
     * @param {object} opts - the options object -- if not set, this function yields an exact clone
     * @param {string} opts.type - type of image e.g. `short'
     * @param {string} opts.numframes - number of frames in clone (null or 0->same)
     * @param {string} opts.numcomponents - number of components in frame in clone (null or 0->same)
     * @param {array} opts.dimensions - new dimensions (null or 'same' ->same). This can be a 3 or a 4-array to also change frames. opts.numframes overrides this.
     * @param {array} opts.spacing - new spacing (null or 'same' ->same)
     */
    cloneImage(inputimage,opts={}) {

        const internal=this.internal;
        
        let newniftitype = opts.type || 'same';
        let newnumframes = opts.numframes || 0;
        let newnumcomponents = opts.numcomponents || 0;
        let newdims = opts.dimensions || 'same';
        let newspacing = opts.spacing || 'same';
        
        if (inputimage.getRawData()===null) {
            console.log('bad image, can not clone');
            return null;
        }
        
        this.initialize();
        let headerdata=inputimage.getHeaderData(true);
        this.parseNII(headerdata.data.buffer,false,true);
        
        let headerstruct=internal.header.struct;
        
        if(newniftitype!=='same') {
            
            let ntype=internal.header.getniftitype(newniftitype);
            if (ntype!==null) {
                //          console.log('ntype=',ntype,'code=',ntype[2]);
                // Fix header first ...
                headerstruct.datatype=ntype[2];

                // name = 
                let outmap=internal.header.gettypesize(ntype[0]);
                headerstruct.bitpix=outmap[0]*8;
                internal.imginfo =  {
                    type: ntype[1],
                    size: headerstruct.bitpix/8,
                    name: ntype[0]
                };
            }
        }
        // -------------------------------------------------------
        // Store key things
        // -------------------------------------------------------
        BisWebImage.parseHeaderAndComputeOrientation(internal);

        // -------------------------------------------------------
        // If needed alter number of frames
        // -------------------------------------------------------

        if (newdims !== 'same') 
            BisWebImage.changeDimensions(internal,newdims);
        
        if (newspacing !== 'same') 
            BisWebImage.changeSpacing(internal,newspacing);
        

        if (newnumframes!==0 || newnumcomponents!==0) {
            if (newnumframes!==0) {
                newnumframes=util.range(newnumframes,1,9999);
                internal.header.struct.dim[4]=newnumframes;
                internal.dimensions[3]=newnumframes;
            }

            if (newnumcomponents!==0) {
                newnumcomponents=util.range(newnumcomponents,1,9999);
                internal.header.struct.dim[5]=newnumcomponents;
                internal.dimensions[4]=newnumcomponents;
                
            }
            internal.volsize=internal.dimensions[0]*internal.dimensions[1]*
                internal.dimensions[2]*internal.dimensions[3]*internal.dimensions[4];
        }
        

        internal.rawsize=internal.volsize*headerstruct.bitpix/8;
        let Imginfo=internal.imginfo.type;
        
        let newbuffer=new ArrayBuffer(internal.rawsize);
        internal._rawdata=new Uint8Array(newbuffer);
        internal.imgdata=new Imginfo(newbuffer);
    }

    /** creates an image (allocate data etc.)
     * @param {object} opts - the options object -- if not set, this function yields an exact clone
     * @param {string} opts.type - type of image e.g. `short'
     * @param {string} opts.numframes - number of frames in clone (null or 0->1)
     * @param {string} opts.numcomponents - number of components in frame in clone (null or 0->1)
     * @param {array} opts.dimensions - new dimensions (null or 'same' ->[10,10,10]). This can be a 3 or a 4-array or 5-array to also change frames/components. opts.numframes and opts.numcomponents
     overrides this.
     * @param {array} opts.spacing - new spacing (null or 'same' -> [1.0,1.0,1.0])
     * @param {string} opts.orientation - LPS or RAS -- (if not specified, RAS)
     */
    createImage(opts={}) {

        const internal=this.internal;
        let newniftitype = opts.type || 'short';
        let newnumframes = opts.numframes || 1;
        let newnumcomponents = opts.numcomponents || 1;
        let newdims = opts.dimensions || [ 10,10,10 ];
        let newspacing = opts.spacing || [ 1.0,1.0,1.0 ];
        let orientation =opts.orientation || "RAS";
        
        // Create header
        this.initialize();
        internal.header.createNIFTIHeader();
        let headerstruct = internal.header.struct;
        
        let ntype=internal.header.getniftitype(newniftitype);
        if (ntype!==null) {
            headerstruct.datatype=ntype[2];
            // name = 
            let outmap=internal.header.gettypesize(ntype[0]);
            headerstruct.bitpix=outmap[0]*8;
            internal.imginfo =  {
                type: ntype[1],
                size: headerstruct.bitpix/8,
                name: ntype[0]
            };

        }
        // -------------------------------------------------------
        // Store key things
        // -------------------------------------------------------
        BisWebImage.parseHeaderAndComputeOrientation(internal);

        // -------------------------------------------------------
        // If needed alter number of frames
        // -------------------------------------------------------

        if (newdims !== 'same') 
            BisWebImage.changeDimensions(internal,newdims);
        
        if (newspacing !== 'same') 
            BisWebImage.changeSpacing(internal,newspacing);
        
        if (newnumframes !==0 || newnumcomponents!==0) {
            if (newnumframes!==0) {
                newnumframes=util.range(newnumframes,1,9999);
                internal.header.struct.dim[4]=newnumframes;
                internal.dimensions[3]=newnumframes;
            }
            
            if (newnumcomponents!==0) {
                newnumcomponents=util.range(newnumcomponents,1,9999);
                internal.header.struct.dim[5]=newnumcomponents;
                internal.dimensions[4]=newnumcomponents;
            }
        }
        internal.volsize=internal.dimensions[0]*internal.dimensions[1]*
            internal.dimensions[2]*internal.dimensions[3]*internal.dimensions[4];

        internal.rawsize=internal.volsize*headerstruct.bitpix/8;
        let Imginfo=internal.imginfo.type;
        
        let newbuffer=new ArrayBuffer(internal.rawsize);
        internal._rawdata=new Uint8Array(newbuffer);
        internal.imgdata=new Imginfo(newbuffer);


        if (orientation === "RAS" || orientation === "LPS") {

            let scale=1.0;
            if (orientation==="LPS")
                scale=-1.0;
            
            internal.header.struct.srow_x[0]=scale*this.internal.spacing[0];
            internal.header.struct.srow_x[1]=0.0;
            internal.header.struct.srow_x[2]=0.0;
            internal.header.struct.srow_x[3]=0.0;
            
            internal.header.struct.srow_y[0]=0.0;
            internal.header.struct.srow_y[1]=scale*internal.spacing[1];
            internal.header.struct.srow_y[2]=0.0;
            internal.header.struct.srow_y[3]=0.0;
            
            internal.header.struct.srow_z[0]=0.0;
            internal.header.struct.srow_z[1]=0.0;
            internal.header.struct.srow_z[2]=internal.spacing[2];
            internal.header.struct.srow_z[3]=0.0;
            internal.header.struct.qform_code=0;
            internal.header.struct.sform_code=1;
            
            /*            internal.orient.axis=[0,1,2];
                          internal.orient.flip=[0,0,0];
                          if (orientation==='LPS')
                          internal.orient.flip=[1,1,0];*/

            BisWebImage.parseHeaderAndComputeOrientation(internal);
        }
        
    }

    /** adds an offset to each image. i.e. this=input+offset. This is mostly for testing. Images must have exactly the same size.
     * @param {BisWebImage} input - the input image
     * @param {number} offset - the value to add
     * @param {array} location - this is a debug voxel
     */
    addoffset(input,offset,location) { 

        const internal=this.internal;
        const debug=this.debug;
        let inp_data=input.getImageData();
        let l=internal.imgdata.length, l2=inp_data.length;
        
        if (l!=l2) {
            throw new Error('Cannot add one to mis-sized image ');
        }
        
        let dim=this.getDimensions();
        
        let index=0;
        if (location)
            index=location[0]+location[1]*dim[0]+location[2]*dim[0]*dim[1];
        
        if (debug) {
            console.log('..... Input Value at ',index,' = ',inp_data[index]);
            console.log('..... in addone type = ',Object.prototype.toString.call(internal.imgdata),", length ",l, "adding "+offset);
        }
        
        for (let i=0;i<l;i++) {
            if (i%3000000 === 0 && debug)
                console.log('.....',i,"/",l);
            internal.imgdata[i]=inp_data[i]+offset;
        }
        
        if (debug)
            console.log('..... Output Value at ',index,' = ',internal.imgdata[index]);
    }



    /** get image orientation 
     * @returns {object} -- this is complicated
     */
    getOrientation()  { return this.internal.orient;}

    /** get image orientation  as string e.g. RAS, LPS etc.
     * @returns {string}
     */
    getOrientationName()  { return this.internal.orient.name; }

    /** get data type as string e.g. ushort, short etc.
     * @returns {string}
     */
    getDataType()  { return this.internal.imginfo.name;}

    /** returns the nifti header 
     * @returns{BisHeader} - the image header
     */
    getHeader() { return this.internal.header; }


    /** get pointer to raw data of Image Header {@link Header}.
     * @param {keepextensions} boolean - if true keep header extensions, else disgard.
     * @returns {Uint8Array} 
     */
    getHeaderData(keepextensions=false)  { return this.internal.header.createHeaderRawData(keepextensions);}

    /** Copy location/orientation info from other image
     * @param{BisWebImage} otherimage - often the reference in a reslicing operations
     */
    copyOrientationInfo(otherimage) {
        this.getHeader().copyOrientationInfo(otherimage.getHeader(),this.getSpacing());
        this.addComment({ "Operation" : "Copied orientation info from "+otherimage.getFilename() });
    }
    
    /** Computes the max absolute value between two images *
     * @param {other} - the other image
     * @returns {number} -- the maximum absolute difference */
    maxabsdiff(other) {
        const internal=this.internal;
        
        let inp_data=other.getImageData();
        let l=internal.imgdata.length, l2=inp_data.length;
        
        if (l!=l2 || l<1) {
            
            console.log('voxoffset=',internal.header.struct.vox_offset);
            console.log(this.printinfo('this'));
            console.log(other.printinfo('other'));
            console.log('Cannot run sumdiff due to mis-sized images this=l'+l+', other=l2='+l2+' d'+other.getDimensions()+' vs'+this.getDimensions());
            throw new Error('Cannot run sumdiff due to mis-sized images this=l'+l+', other=l2='+l2+' d'+other.getDimensions()+' vs'+this.getDimensions());
        }
        
        let index=0;
        
        if (this.debug) {
            console.log('..... Input Values at ',index,' = ',inp_data[index],internal.imgdata[index]);
        }
        
        let maxd=0.0;
        for (let i=0;i<l;i++) {
            if (i%3000000 === 0 && this.debug)
                console.log('.....',i,"/",l);
            let d=Math.abs(internal.imgdata[i]-inp_data[i]);
            if (d>maxd)
                maxd=d;
        }
        
        if (this.debug)
            console.log('..... maxabsdiff=',maxd);
        return maxd;
    }

    /** compare dimensions and spacing, return true if same 
     * @param{BisWebImage} otherimage - the image to compare to
     * @param{number} threshold - spacing comparison threshold (default=0.001)
     * @param{Boolean} spaceonly - if true (default=false) then only x,y,z dims are compared
     @returns {Boolean} true if this image and other image have same dimensions */
    hasSameSizeAndOrientation(otherimage,threshold=0.01,spaceonly=false) {

        let d1=this.getDimensions();
        let d2=otherimage.getDimensions();
        let s1=this.getSpacing();
        let s2=otherimage.getSpacing();

        let same=true;

        let maxd=d1.length;
        if (spaceonly)
            maxd=3;
        
        for (let i=0;i<maxd;i++) {
            if (d1[i]!==d2[i])
                same=false;
        }

        if (same) {

            let maxs=s1.length;
            if (spaceonly)
                maxs=3;

            
            for (let i=0;i<maxs;i++) {
                let diff=Math.abs(s1[i]-s2[i]);
                if (diff>threshold)
                    same=false;
            }

            if (same) {
                let o1=this.getOrientationName();
                let o2=otherimage.getOrientationName();
                if (o1!==o2)
                    same=false;
            }
        }
        return same;
    }


    /** parses a header (nifti header) to create a new image
     * @param {BisHeader} header - the header spec for the image
     */
    createFromHeader(header) {

        this.initialize();
        let hdata=header.createHeaderRawData(false);
        this.internal.header.parse(hdata.data.buffer,hdata.length);
        
        if (this.debug) {
            console.log('+++++ dims=',this.internal.header.struct.dim[1],this.internal.header.struct.dim[2],this.internal.header.struct.dim[3],this.internal.header.struct.dim[4]);
        }
        
        // Next get ready for the real thing
        let dt=this.internal.header.struct.datatype;
        let typename=this.internal.header.getniftitype(dt);     
        
        this.internal.imginfo =  {
            type: typename[1],
            size: this.internal.header.struct.bitpix/8,
            name: typename[0],
        };
        if (this.debug)
            console.log('+++++ imginfo',this.internal.imginfo.type,' tn=',typename,' dt=',dt);
        // -------------------------------------------------------
        // Store key things
        // -------------------------------------------------------
        BisWebImage.parseHeaderAndComputeOrientation(this.internal);
        this.internal.rawsize=this.internal.volsize*this.internal.header.struct.bitpix/8;
        let Imginfo=this.internal.imginfo.type;
        this.internal._rawdata=new Uint8Array(this.internal.rawsize);
        this.internal.imgdata=new Imginfo(this.internal._rawdata.buffer);
        if (this.debug)
            console.log("+++++ created rawdata of size="+this.internal._rawdata.length);
        this.internal.range[0]=0.0;
        this.internal.range[1]=0.0;
        return true;
    }


    
    

    /** serialize to NII Binary array 
     * creates a uint8 array with all the data
     * @return {Uint8Array}
     */
    serializeToNII() {

        const internal=this.internal;
        let dt=internal.header.struct.datatype;
        let typename=internal.header.getniftitype(dt);
        if (this.debug)
            console.log('+++++++ serialiazing dt=',dt,' tpname=',typename);
        
        internal.header.setExtensionsFromArray(this.commentlist);
        let headerbin=this.getHeaderData(true);
        let rawdata=this.getRawData();
        
        
        if (internal.singlebuffer===null) {
            let c=new Uint8Array(headerbin.length+rawdata.length);
            c.set(headerbin.data);
            c.set(rawdata,headerbin.length);
            headerbin=null;
            rawdata=null;
            return c;
        }
        if (this.debug)
            console.log('this is a single buffer case ...');
        return new Uint8Array(internal.singlebuffer,0,headerbin.length+rawdata.length);
    }
    
    /** parses a binary buffer (nifti image) to create the image
     * @param {ArrayBuffer} _inputbuffer - the raw array buffer that is read using some File I/O operation
     * @param {String} forceorient in - if set to "RAS" or true the image will be repermuted to be RAS (axial) oriented. If set to LPS it will be mapped to LPS. 
     * @param {boolean} forcecopy -- if false then potential store image in existing inputbuffer (use this for large images)
     */
    parseNII(_inputbuffer,forceorient_in,forcecopy=false) {
        
        forcecopy = true;
        
        let forceorient=userPreferences.sanitizeOrientationOnLoad(forceorient_in);
        const debug=this.debug;
        const internal=this.internal;
        
        if (debug)
            console.log('..... in PARSENII BUFFER forceorient=',forceorient);
        
        // First do header stuff
        let tmpfloat=new Float32Array(_inputbuffer,108,1);
        let len=Math.floor(tmpfloat[0]);
        if (len<1 || len >300000) {
            throw new Error('BAD BAD BAD ..... in PARSENII BUFFER len='+len);
        }
        
        internal.singlebuffer=null;
        
        let tmpheaderdata;
        if (forceorient!=="None" || forcecopy===true) {
            tmpheaderdata=_inputbuffer.slice(0,len);
            internal.header.parse(tmpheaderdata,len);
        } else {
            internal.header.parse(_inputbuffer,len);
            internal.singlebuffer=_inputbuffer;
            if (debug)
                console.log('Linking data ... not copying');
        }
        
        if (internal.header.struct.dim[1]===0) {
            throw new Error('BAD dimensions');
        }
        
        if (debug) {
            console.log('+++++ dims=',internal.header.struct.dim[1],internal.header.struct.dim[2],internal.header.struct.dim[3],internal.header.struct.dim[4]);
            console.log('+++++ Read header type = ',Object.prototype.toString.call(tmpheaderdata),' off',internal.header.struct.vox_offset);
        }
        tmpheaderdata=null;
        
        // Next get ready for the real thing
        let dt=internal.header.struct.datatype;
        let typename=internal.header.getniftitype(dt);
        if (debug)
            console.log('+++++++ dt=',dt,' tpname=',typename);
        
        internal.imginfo =  {
            type: typename[1],
            size: internal.header.struct.bitpix/8,
            name: typename[0],
        };
        if (debug)
            console.log('+++++ imginfo',internal.imginfo.type,' tn=',typename,' dt=',dt);
        // -------------------------------------------------------
        // Store key things
        // -------------------------------------------------------
        BisWebImage.parseHeaderAndComputeOrientation(internal);
        //if (debug)    
        //      console.log('+++++ orientation: name=',internal.orient.name,'(axis = ',internal.orient.axis, ' flip=', internal.orient.flip,' imginfo',internal.imginfo,'dims=',internal.dimensions);
        let headerlength=internal.header.struct.vox_offset;
        //      console.log('headerlength=',headerlength,'\n\n\n\n');
        internal.rawsize=internal.volsize*internal.header.struct.bitpix/8;
        let Imginfo=internal.imginfo.type;
        let imgend=headerlength+internal.rawsize;
        
        if (forceorient === "None" || forceorient === internal.orient.name) {
            // Just link the data over
            
            if (forcecopy===true) {
                internal._rawdata=new Uint8Array(_inputbuffer.slice(headerlength,imgend));
                internal.imgdata=new Imginfo(internal._rawdata.buffer);
            } else {
                if (internal.singlebuffer===null) {
                    // Reparse
                    internal.header.parse(_inputbuffer,len);
                    internal.singlebuffer=_inputbuffer;
                }
                internal.imgdata=new Imginfo(_inputbuffer,headerlength,internal.volsize);
                internal._rawdata=new Uint8Array(_inputbuffer,headerlength,internal.rawsize);
                internal._rawdata.bisbyteoffset=headerlength;
                internal.imgdata.bisbyteoffset=headerlength;
            }
            if (debug) console.log('++++++ not permuting data');
            internal.forcedorientationchange=false;
        } else  {
            // More complex as we need to repermute the data
            let newbuffer=new ArrayBuffer(internal.rawsize);
            internal._rawdata=new Uint8Array(newbuffer);
            internal.imgdata=new Imginfo(newbuffer);
            let origdata=new Imginfo(_inputbuffer);
            if (debug)
                console.log('+++++ permuting data ',forceorient);
            BisWebImage.permuteDataToMatchDesiredOrientation(internal,origdata,headerlength/internal.imginfo.size,internal.imgdata,forceorient);
            internal.forcedorientationchange=true;
        }
        
        
        // Eliminate Nan's
        for (let i=0;i<internal.imgdata.length;i++) {
            if (internal.imgdata[i]!==internal.imgdata[i])
                internal.imgdata[i]=0;
        }
        
        this.commentlist=internal.header.parseExtensionsToArray();
        this.computeIntensityRange();
        
    }

        
    /** parse single frame tiff file -- parses multipage tiff document 
     * @param {Uint8Array} input_rawdata -- the raw data
     * @param {String} filename -- the original filename
     * @param {String} forceorient -- if set to force orientation (e.g. LPS, RAS)
     */
    parseSingleFrameTIFF(input_rawdata,filename,forceorient) {

        let decoder=tiff.newobject(input_rawdata);
        decoder.decodeHeader();
            
        let frame=decoder.decodeIFD({ignoreImageData: false});

        let xspa= frame.xResolution || 0.025;
        let yspa= frame.yResolution || 0.025;
        let zspa= frame.zResolution || 1.0;
        
        let data_type='ushort';
        if (frame.data.constructor.name==="Int16Array") {
            data_type='short';
        }
        console.log('Creating image',xspa,yspa,zspa);

        let orient='LPS';
        if (forceorient === 'RAS') {
            orient='RAS';
        }
        
        this.createImage( { dimensions : [ frame.width,frame.height,1 ],
                            numframes : 1,
                            spacing : [ xspa,yspa,zspa ],
                            type : data_type ,
                            orientation : orient,
                          });
        
        let data=this.getImageData();
        data.set(frame.data);

        console.log('ForceOrient=',forceorient);

        if (orient==='RAS') {
            let maxi=frame.width-1;
            let maxj=frame.height-1;
            let half=Math.floor(frame.height*0.5);
            for (let i=0;i<frame.width;i++) {
                for (let j=0;j<half;j++) {
                    let index1=j*frame.width+i;
                    let index2=(maxi-i)+(maxj-j)*frame.width;
                    let tmp=data[index2];
                    data[index2]=data[index1];
                    data[index1]=tmp;
                }
            }
        } 
        
        // Eliminate Nan's
        for (let i=0;i<data.length;i++) {
            if (data[i]!==data[i])
                data[i]=0;
        }
        
        
        let fname=filename;
        if (fname.name)
            fname=fname.name;
        this.setFilename(fname);
        this.commentlist= [ 'loaded from '+ fname +' forceorient='+forceorient ];
        this.computeIntensityRange();
        return;
    }

    
    /** parse tiff file -- parses multipage tiff document 
     * @param {Uint8Array} arr -- the raw data
     * @param {String} filename -- the original filename
     * @param {String} forceorient -- if set to force orientation (e.g. LPS, RAS)
     */
    parseTIFF(inputbuffer,filename,forceorient) {
        
        this.debug=1;
        const internal=this.internal;
        let input_rawdata=new Uint8Array(inputbuffer);
        let numframes=tiff.pageCount(input_rawdata);
        
        if (numframes===1) {
            this.parseSingleFrameTIFF(input_rawdata,filename,forceorient);
            return;
        }

        let orient='LPS';
        if (forceorient==='RAS')
            orient='RAS';
        
        if (numframes>500)
            this.debug=2;
        console.log('+++++++++++++++++++++++++++++++++++++++++\n');
        console.log('+++++ Parsing tiff numpages=',numframes,' filename=',filename,input_rawdata.constructor.name,input_rawdata.length,'buffername=',inputbuffer.constructor.name);
        let decoder=tiff.newobject(input_rawdata);
        decoder.decodeHeader();

        let numpieces=500;
        if (numpieces>numframes)
            numpieces=numframes;
        let temp_img=new BisWebImage();
        let pieceframe=0;
        let storeoffset=0;

        let lastframe=0;
        let data_type='ushort';
        
        for (let f=0;f<numframes;f++) {

            //let readoffset=decoder.nextIFD;
            
            let frame=decoder.decodeIFD({ignoreImageData: false});

            
            
            if (f==0) {
                if (frame.data.constructor.name==="Int16Array") {
                    data_type='short';
                }

                let xspa= frame.xResolution || 0.025;
                let yspa= frame.yResolution || 0.025;
                
                temp_img.createImage( { dimensions : [ frame.width,frame.height,1 ],
                                        numframes : numpieces,
                                        spacing : [ xspa,yspa,1.0 ],
                                        orientation : orient,
                                        type : data_type });
            }
            
            let data=temp_img.getImageData();

            let temp_offset=frame.width*frame.height*pieceframe;
            let slicebytesize=frame.data.length*2;
            let bisoffset=data.bisbyteoffset || 0;
            let data_part=null;
            if (data_type==='short')
                data_part=new Int16Array(data.buffer,bisoffset+temp_offset*2,frame.data.length);
            else
                data_part=new Uint16Array(data.buffer,bisoffset+temp_offset*2,frame.data.length);
            
            data_part.set(frame.data);
            if (orient === 'RAS') {
                // We need to flip as data coming in is LPS (at least for our data)
                let maxi=frame.width-1;
                let maxj=frame.height-1;
                let half=Math.floor(frame.height*0.5);
                for (let i=0;i<frame.width;i++) {
                    for (let j=0;j<half;j++) {
                        let index1=j*frame.width+i;
                        let index2=(maxi-i)+(maxj-j)*frame.width;
                        let tmp=data_part[index2];
                        data_part[index2]=data_part[index1];
                        data_part[index1]=tmp;
                    }
                }
            }

            pieceframe+=1;
            
            if (pieceframe>=numpieces || f===numframes-1) {
                let nextstrip=frame.stripOffsets[0]+slicebytesize;
                let nextstore=storeoffset+slicebytesize*numpieces;
                if (nextstore>=nextstrip)  {
                    throw new Error(`Can not store this tiff image strip=${nextstrip} < ${nextstore}, slicesize=${slicebytesize}`);
                }
                
                if (storeoffset===0) {
                    // Copy the header
                    let header=temp_img.getHeader();
                    header.struct.dim[0]=4;
                    header.struct.dim[4]=numframes;
                    let dat=header.createHeaderRawData(false).data;
                    let header_rawdata=new Uint8Array(inputbuffer,0,dat.length);
                    header_rawdata.set(dat);
                    storeoffset=dat.length;
                }
                
                let buffersize=(pieceframe)*slicebytesize;
                let data=temp_img.getImageData();
                let numpieceframes=(f-lastframe+1);
                let newsize=frame.width*frame.height*numpieceframes;
                let temp16=null;
                let data16=null;
                if (data_type==="ushort") {
                    temp16=new Uint16Array(inputbuffer,storeoffset,newsize);
                    data16=new Uint16Array(data.buffer,0,newsize);
                } else {
                    temp16=new Int16Array(inputbuffer,storeoffset,newsize);
                    data16=new Int16Array(data.buffer,0,newsize);

                }
                
                if (this.debug>1 || numframes>2000)
                    console.log(`Beginning to store frames ${lastframe}:${f} from ${storeoffset} to ${storeoffset+buffersize} (length in bytes=${buffersize}, ${(f-lastframe+1)*slicebytesize}) newsize=${newsize} `);

                temp16.set(data16);
                storeoffset+=buffersize;
                pieceframe=0;
                lastframe=f+1;
            }
        }
        
        
        let headerlen=352;
        internal.singlebuffer=inputbuffer;
        internal.header.parse(inputbuffer,headerlen);
        
        let dt=internal.header.struct.datatype;

        let typename=internal.header.getniftitype(dt);

        internal.imginfo =  {
            type: typename[1],
            size: internal.header.struct.bitpix/8,
            name: typename[0],
        };
        // -------------------------------------------------------
        // Store key things
        // -------------------------------------------------------
        BisWebImage.parseHeaderAndComputeOrientation(internal);
        let headerlength=internal.header.struct.vox_offset;

        internal.rawsize=internal.volsize*internal.header.struct.bitpix/8;
        let Imginfo=internal.imginfo.type;
        internal._rawdata=new Uint8Array(inputbuffer,headerlength,internal.rawsize);
        internal.imgdata=new Imginfo(inputbuffer,headerlength,internal.volsize);
        internal._rawdata.bisbyteoffset=headerlength;
        internal.imgdata.bisbyteoffset=headerlength;

        this.computeIntensityRange();
        this.setFilename(filename);
    }

    /** Legacy Debug Print Function */
    printinfo(comment) {
        const internal=this.internal;
        comment = comment || "";
        let a='+++++ Printing image info:'+comment+"\n";
        a+="+++++ dimensions= :"+internal.dimensions+", spacing="+internal.spacing+", orient=" + internal.orient.name +' ' +internal.orient.axis+' ' +internal.orient.flip +"(inv="+internal.orient.invaxis+','+internal.orient.invflip+')';
        a+=" range "+internal.range + ' data type='+internal.header.struct.datatype+'('+internal.imginfo.name+")\n";
        if (internal.imgdata!==null) {
            let b=Object.prototype.toString.call(internal.imgdata);
            a+="+++++ type of imgdata:"+b+", size of imgdata:" + internal.imgdata.length+ "("+internal._rawdata.length+"), bitpix="+internal.header.struct.bitpix;
        }
        return a;
    }

    /** Adds Quaternion Info to header
     * @param{EmscriptenModule} Module
     */
    
    addQuaternionCode(Module) {
        const internal=this.internal;
        
        if (internal.header.struct.qform_code!==0 ||
            internal.header.struct.sform_code===0)
            return;
        

        let mat=new BisWebMatrix();
        mat.allocate(4,4,0);
        mat.setElement(3,3,1.0);
        
        for (let j=0;j<=3;j++) {
            mat.setElement(0,j,internal.header.struct.srow_x[j]);
            mat.setElement(1,j,internal.header.struct.srow_y[j]);
            mat.setElement(2,j,internal.header.struct.srow_z[j]);
        }

        
        let quat=Module.niftiMat44ToQuaternionWASM(mat).data;
        console.log('quat=',quat[0],quat[1],quat[2],' ',quat[3],quat[4],quat[5]);
        
        internal.header.struct.qform_code=1;
        internal.header.struct.qoffset_b=quat[0];
        internal.header.struct.qoffset_c=quat[1];
        internal.header.struct.qoffset_d=quat[2];
        internal.header.struct.qoffset_x=quat[3];
        internal.header.struct.qoffset_y=quat[4];
        internal.header.struct.qoffset_z=quat[5];
        internal.header.struct.pixdim[0]=quat[9];
        internal.header.struct.pixdim[1]=quat[6];
        internal.header.struct.pixdim[2]=quat[7];
        internal.header.struct.pixdim[3]=quat[8];
    }

    /** Static Function to change Spacing inside a header 
     * @param{Dictionary} internal -- thisinternal from a BisWebImage
     */
    static changeSpacing(internal,newspa) {

        internal.header.struct.pixdim[1]=newspa[0];
        internal.header.struct.pixdim[2]=newspa[1];
        internal.header.struct.pixdim[3]=newspa[2];

        if (internal.header.struct.sform_code > 0) {
            let sx = internal.header.struct.srow_x, sy = internal.header.struct.srow_y, sz = internal.header.struct.srow_z;
            let magn = [
                Math.sqrt(sx[0]*sx[0]+sx[1]*sx[1]+sx[2]*sx[2]),
                Math.sqrt(sy[0]*sy[0]+sy[1]*sy[1]+sy[2]*sy[2]),
                Math.sqrt(sz[0]*sz[0]+sz[1]*sz[1]+sz[2]*sz[2]),
            ];

            //      console.log('sx=',sx[0],sx[1],sx[2]);
            //      console.log('sy=',sy[0],sy[1],sy[2]);
            //      console.log('sz=',sz[0],sz[1],sz[2]);
            //      console.log('magn=',magn);

            for (let ia=0;ia<=2;ia++) {
                sx[ia]*=newspa[0]/magn[0];
                sy[ia]*=newspa[1]/magn[1];
                sz[ia]*=newspa[2]/magn[2];
            }

            //      console.log('sx=',sx[0],sx[1],sx[2]);
            //      console.log('sy=',sy[0],sy[1],sy[2]);
            //      console.log('sz=',sz[0],sz[1],sz[2]);

        }

        for (let i=0;i<=2;i++) {
            internal.spacing[i]=newspa[i];
        }
    }


    static changeDimensions(internal,newdim) {

        let l=newdim.length;
        if (l<3 || l>5) 
            throw(new Error('Cannot change dimensions to '+newdim+' bad array'));           

        for (let i=0;i<l;i++) {
            internal.dimensions[i]=newdim[i];
            internal.header.struct.dim[i+1]=newdim[i];
        }

        internal.volsize = internal.dimensions[0] * internal.dimensions[1] * internal.dimensions[2] * internal.dimensions[3]*internal.dimensions[4];
        internal.offsets =   [ 1,
                               internal.dimensions[0], internal.dimensions[0]*internal.dimensions[1], 
                               internal.dimensions[0]*internal.dimensions[1]*internal.dimensions[2],
                               internal.dimensions[0]*internal.dimensions[1]*internal.dimensions[3],
                             ];
        //console.log('+++++ internal.vol='+internal.volsize+' offsets='+internal.offsets);
    }

    /** Function (initially from xtk {@link www.xtk.org})
        to parse the header and compute orientation. It's implcit input
        is internal.header.struct and output goes into internal
    */
    static parseHeaderAndComputeOrientation(internal) {

        // Create IJKtoXYZ matrix
        let IJKToRAS = simplemat.GMMat4.createFloat32();
        simplemat.GMMat4.setRowValues(IJKToRAS,3,0,0,0,1);
        let i=0;

        // 3 known cases
        let pixdim=internal.header.struct.pixdim;
        let dim=internal.header.struct.dim;
        if(internal.header.struct.qform_code > 0) {
            //      console.log('using q_form');
            //https://github.com/Kitware/ITK/blob/master/Modules/IO/NIFTI/src/itkNiftiImageIO.cxx
            let a = 0.0, b = internal.header.struct.quatern_b, c = internal.header.struct.quatern_c, d = internal.header.struct.quatern_d;
            let xd = 1.0, yd = 1.0, zd = 1.0;
            let qx = internal.header.struct.qoffset_x, qy = internal.header.struct.qoffset_y, qz = internal.header.struct.qoffset_z;

            // compute a
            a = 1.0 - (b*b + c*c + d*d) ;
            if( a < 0.0000001 ){                   /* special case */

                a = 1.0 / Math.sqrt(b*b+c*c+d*d) ;
                b *= a ; c *= a ; d *= a ;        /* normalize (b,c,d) vector */
                a = 0.0;                       /* a = 0 ==> 180 degree rotation */

            } else {
                a = Math.sqrt(a) ;                     /* angle = 2*arccos(a) */
            }

            // scaling factors
            if(pixdim[1] > 0.0) {
                xd = pixdim[1];
            }

            if(pixdim[2] > 0.0) {
                yd = pixdim[2];
            }
            if(pixdim[2] > 0.0) {
                zd = pixdim[3];
            }
            // qfac left handed
            if(pixdim[0] < 0.0) {
                zd = -zd;
            }
            // fill IJKToRAS
            simplemat.GMMat4.setRowValues(IJKToRAS,  0,  (a*a+b*b-c*c-d*d)*xd,  2*(b*c-a*d)*yd,  2*(b*d+a*c)*zd,  qx );
            simplemat.GMMat4.setRowValues(IJKToRAS,  1,  2*(b*c+a*d)*xd,  (a*a+c*c-b*b-d*d)*yd,  2*(c*d-a*b)*zd,  qy );
            simplemat.GMMat4.setRowValues(IJKToRAS,  2,  2*(b*d-a*c )*xd,  2*(c*d+a*b)*yd,  (a*a+d*d-c*c-b*b)*zd,  qz );

        } else if(internal.header.struct.sform_code > 0) {

            //      console.log('using s_form');
            let sx = internal.header.struct.srow_x, sy = internal.header.struct.srow_y, sz = internal.header.struct.srow_z;
            // fill IJKToRAS
            simplemat.GMMat4.setRowValues(IJKToRAS, 0, sx[0], sx[1], sx[2], sx[3]);
            simplemat.GMMat4.setRowValues(IJKToRAS, 1, sy[0], sy[1], sy[2], sy[3]);
            simplemat.GMMat4.setRowValues(IJKToRAS, 2, sz[0], sz[1], sz[2], sz[3]);
            pixdim[1] = Math.sqrt(sx[0]*sx[0]+sy[0]*sy[0]+sz[0]*sz[0]);
            pixdim[2] = Math.sqrt(sx[1]*sx[1]+sy[1]*sy[1]+sz[1]*sz[1]);
            pixdim[3] = Math.sqrt(sx[2]*sx[2]+sy[2]*sy[2]+sz[2]*sz[2]);

        } else if(internal.header.struct.qform_code === 0) {
            // fill IJKToRAS 
            simplemat.GMMat4.setRowValues(IJKToRAS, 0, pixdim[1], 0, 0, 0);
            simplemat.GMMat4.setRowValues(IJKToRAS, 1, 0, pixdim[2], 0, 0);
            simplemat.GMMat4.setRowValues(IJKToRAS, 2, 0, 0, pixdim[3], 0);

        } else {
            console.log('UNKNOWN METHOD IN PARSER NIIX');

        }

        // IJK to RAS 
        internal.orient.IJKToRAS = IJKToRAS;
        //      console.log("----- internal.IJKTORAS=",simplemat.GMMat4.print(internal.orient.IJKToRAS));
        if (dim[5]===0)
            dim[5]=1;
        if (pixdim[5]===0.0)
            pixdim[5]=1.0;
        internal.dimensions= [ dim[1],dim[2],dim[3],dim[4],dim[5] ];
        internal.spacing=    [ pixdim[1], pixdim[2],pixdim[3],pixdim[4],pixdim[5] ];
        for (let ik=0;ik<=2;ik++) 
            internal.spacing[ik]=Math.round(internal.spacing[ik]*1000.0)*0.001;

        internal.volsize = dim[1] * dim[2] * dim[3]*dim[4]*dim[5];
        internal.offsets =   [ 1, dim[1], dim[1]*dim[2], dim[1]*dim[2]*dim[3], dim[1]*dim[2]*dim[3]*dim[4] ];

        // We need the RAS to IJK to figure out orientation
        let invMat = simplemat.GMMat4.createFloat32();
        simplemat.GMMat4.invert(internal.orient.IJKToRAS,invMat);
        let combo = [ [ 0,0,0 ], [ 0,0,0 ],[ 0,0,0 ]];
        for (i=0;i<=2;i++) {
            for (let j=0;j<=2;j++)
                combo[i][j]=invMat[i*4+j];

        }
        //console.log('combo=[ ',combo[0][0],combo[0][1],combo[0][2],']\n[',combo[1][0],combo[1][1],combo[1][2],']\n[', combo[2][0],combo[2][1],combo[2][2],']\n');
        // Fix * spacing instead of /spacing as dealing with inverse
        let axis=[ 0 ,1, 2 ], flip=[ 0 ,0, 0 ];
        for (let ia=0;ia<=2;ia++) {
            for (let ib=0;ib<=2;ib++) {
                if (axis[ia]!=ib) {
                    if (Math.abs(combo[ia][ib]*internal.spacing[ib])>Math.abs(combo[ia][axis[ia]]*internal.spacing[axis[ia]])) {
                        axis[ia]=ib;
                    }
                }
            }
            if (combo[ia][axis[ia]]<0)
                flip[ia]=1;
        }
        internal.orient.axis=axis;
        for (let k=0;k<=2;k++) {
            let cj=0,truej=0;
            while (cj<=2) {
                if (axis[cj]==k) {
                    truej=cj;
                    cj=3;
                }
                ++cj;
            }
            internal.orient.invaxis[k]=truej;
            internal.orient.invflip[k]=flip[truej];
        }

        internal.orient.flip=flip;
        internal.orient.name='';
        let names = [ [ 'L','R' ],[ 'P','A' ], ['I','S']];
        for (i=0;i<=2;i++) {
            //  console.log('invaxis='+internal.orient.invaxis[i]+' names='+names[i]);
            internal.orient.name+=names[internal.orient.invaxis[i]][1-internal.orient.invflip[i]];
        }
        //      console.log('name='+internal.orient.name+' flip='+internal.orient.flip+' axis='+internal.orient.axis);
    }

    /** Function to permute the header to yield a RAS image. Still incomplete.
     */
    static permuteHeaderDimensionsSpacing(internal) {
        // called at end of permute orientations to fix things
        let axis=internal.orient.axis;
        let olddim = [ internal.dimensions[0],internal.dimensions[1],internal.dimensions[2]];
        let oldspa = [ internal.spacing[0], internal.spacing[1],internal.spacing[2] ];
        let newdim = [];
        let newspa = [];
        for (let i=0;i<=2;i++) {
            newdim[i]=olddim[axis[i]];
            newspa[i]=oldspa[axis[i]];
        }

        BisWebImage.changeDimensions(internal,newdim);
        BisWebImage.changeSpacing(internal,newspa);
    }


    /** Function to permute the image data to yield a RAS oriented image. Works but header is incomplete
        @alias BisImageUtilities~permuteDataToMatchDesiredOrientation
    */
    static permuteDataToMatchDesiredOrientation(internal,inarray,inoffset,outarray,forceorient) {
        
        let dim = [ internal.dimensions[0],internal.dimensions[1],internal.dimensions[2] ];
        let framesize=dim[0]*dim[1]*dim[2];

        // This permutes internal.dimensions hence dim is a copy of original
        BisWebImage.permuteHeaderDimensionsSpacing(internal);
        //  if (debug)
        //      console.log('+++++ permuted header, new dims=', internal.dimensions,'inoffset=',inoffset);
        // Increments
        let outincr= [ 1, internal.dimensions[0], internal.dimensions[0]*internal.dimensions[1] ];
        // Straight from BioImage Suite
        let ia= [ 0,0,0 ],ib=[ 0,0,0 ],j=0,outindex=0,frame=0,baseframe=0,nc=internal.dimensions[3]*internal.dimensions[4];
        let index=inoffset;

        let flipdim = [ internal.dimensions[0]-1, internal.dimensions[1]-1,internal.dimensions[2]-1];
        let axis    = [ internal.orient.axis[0], internal.orient.axis[1], internal.orient.axis[2] ];
        let flip    = [ internal.orient.flip[0], internal.orient.flip[1], internal.orient.flip[2] ];

        //        console.log('Original flip=',flip);

        let scaleXYaxis=1;
        if (forceorient==="LPS") {
            //          console.log('Extra Flipping');
            scaleXYaxis=-1;
            for (let ia=0;ia<=1;ia++) {
                flip[ia]=1-flip[ia];
                internal.orient.flip[ia]=1-internal.orient.flip[ia];
                internal.orient.invflip[ia]=1-internal.orient.invflip[ia];
            }
        }

        //        console.log('Actual Flips=',flip);

        for (ia[2]=0;ia[2]<dim[2];ia[2]++) {
            for (ia[1]=0;ia[1]<dim[1];ia[1]++) {
                for (ia[0]=0;ia[0]<dim[0];ia[0]++) {
                    outindex=0;
                    for (j=0;j<=2;j++) {
                        if (flip[j]) 
                            ib[j]=flipdim[j]-ia[axis[j]];
                        else
                            ib[j]=ia[axis[j]];              
                        outindex+=ib[j]*outincr[j];
                    }
                    if (nc>0) {
                        for (frame=0;frame<nc;frame++) {
                            baseframe=frame*framesize;
                            outarray[outindex+baseframe]=inarray[index+baseframe];
                        }
                    } else {
                        outarray[outindex]=inarray[index];
                    }
                    ++index;
                }
            }
        }

//        console.log('scaleXYaxis=',scaleXYaxis,axis,flip);

        //  let end=new Date().getTime();
        //  let time=end-start;
        //if (debug)
        //      console.log('****** ellapsed time=',time, ' optimized=',optimized);
        //  optimized=!optimized;


        if (scaleXYaxis<0) {
            internal.orient.name="LPS";
        } else {
            internal.orient.name="RAS";
        }


        simplemat.GMMat4.setRowValues(internal.orient.IJKToRAS, 0, scaleXYaxis*internal.spacing[0], 0, 0, 0);
        simplemat.GMMat4.setRowValues(internal.orient.IJKToRAS, 1, 0, scaleXYaxis*internal.spacing[1], 0, 0);
        simplemat.GMMat4.setRowValues(internal.orient.IJKToRAS, 2, 0, 0, internal.spacing[2], 0);
        internal.header.struct.qform_code=0;
        internal.header.struct.sform_code=1;


        internal.header.struct.srow_x[0]=scaleXYaxis*internal.spacing[0];
        internal.header.struct.srow_x[1]=0.0;
        internal.header.struct.srow_x[2]=0.0;
        internal.header.struct.srow_x[3]=0.0;

        internal.header.struct.srow_y[0]=0.0;
        internal.header.struct.srow_y[1]=scaleXYaxis*internal.spacing[1];
        internal.header.struct.srow_y[2]=0.0;
        internal.header.struct.srow_y[3]=0.0;

        internal.header.struct.srow_z[0]=0.0;
        internal.header.struct.srow_z[1]=0.0;
        internal.header.struct.srow_z[2]=internal.spacing[2];
        internal.header.struct.srow_z[3]=0.0;
        
    }

}

module.exports=BisWebImage;

