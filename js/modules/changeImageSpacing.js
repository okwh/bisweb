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

'use strict';

const BaseModule = require('basemodule.js');
const baseutils=require("baseutils");
const BisWebImage = require('bisweb_image.js');
// Image1 + Image2 + Transformation -> Output
// Reslices Image2 using Transformation to make an image that looks like Image1
//
// Resample
// ImageToImage .. change resolution
/**
 * Resamples a given image to use a new set of voxel spacings. Can specify how voxels should be interpolated, either nearest-neighbor,
 * linear interpolation, or cubic interpolation.
 */
class ChangeImageSpacingModule extends BaseModule {
    constructor() {
        super();
        this.name = 'changeImageSpacing';
    }


    createDescription() {
        return {
            "name": "Change Image Spacing",
            "description": "Changes the image header to have new spacing",
            "author": "Xenios Papademetris",
            "version": "1.0",
            "inputs": baseutils.getImageToImageInputs(),
            "outputs": baseutils.getImageToImageOutputs(),
            "buttonName": "Change Header",
            "shortname" : "sp",
            "params": [
                {
                    "name": "X Spacing",
                    "description": "Desired voxel spacing in X direction",
                    "priority": 1,
                    "advanced": false,
                    "gui": "slider",
                    "type": "float",
                    "varname": "xsp",
                    "default" : -1.0,
                },
                {
                    "name": "Y Spacing", 
                    "description": "Desired voxel spacing in Y direction",
                    "priority": 2,
                    "advanced": false,
                    "gui": "slider",
                    "type": "float",
                    "varname": "ysp",
                    "default" : -1.0,
                },
                {
                    "name": "Z Spacing", 
                    "description": "Desired voxel spacing in Z direction",
                    "priority": 3,
                    "advanced": false,
                    "gui": "slider",
                    "type": "float",
                    "varname": "zsp",
                    "default" : -1.0,
                },
            ]
        };
    }


    directInvokeAlgorithm(vals) {
        console.log('oooo invoking: changeImageSpacing with vals', JSON.stringify(vals));
        return new Promise((resolve, reject) => {
            let input = this.inputs['input'];
            if (input===null)
                reject('Bad Input');
            
            let output = new BisWebImage();
            let spa=input.getSpacing();
            console.log('oooo Original spacing to ',spa);
            
            let inspa = [ parseFloat(vals.xsp), parseFloat(vals.ysp), parseFloat(vals.zsp) ];

            for (let i = 0; i <=2; i++) {
                if (inspa[i]>0.0)
                    spa[i]=inspa[i];
            }

            console.log('oooo Setting spacing to ',spa);
            
            output.cloneImage(input, { 'spacing' : spa });
            output.getImageData().set(input.getImageData());
            this.outputs['output']=output;
            resolve();
        });
    }

    updateOnChangedInput(inputs,controllers=null,guiVars=null) {

        let newDes = this.getDescription();
        inputs = inputs || this.inputs;
        let current_input = inputs['input'] || null;
        if (current_input===null)
            return newDes;

        let spa=current_input.getSpacing();
        console.log('Spa=',spa);
        for (let i = 0; i < newDes.params.length; i++) {
            let name = newDes.params[i].varname;
            let index= [ 'xsp','ysp','zsp'].indexOf(name);

            if (index>=0) {
                console.log('index=',index,newDes.params[i].default);
                newDes.params[i].low=0.0001;
                newDes.params[i].high=10.0;
                newDes.params[i].step=0.0001;
                if (newDes.params[i].default<0) {
                    newDes.params[i].default=spa[i];
                }
                console.log('index=',index,newDes.params[i].default);
                if (controllers!==null)
                    this.updateSingleGUIElement(newDes.params[i],controllers[name],guiVars,name);
                
            }
        }
        return newDes;
    }
    
}

module.exports = ChangeImageSpacingModule;
