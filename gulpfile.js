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

/* jshint node:true */

"use strict";

require('./config/bis_checknodeversion');

const gulp = require('gulp'),
      program=require('commander'),
      connect = require('gulp-connect'),
      os = require('os'),
      path=require('path'),
      del = require('del'),
      colors=require('colors/safe'),
      runSequence = require('run-sequence'),
      bis_gutil=require('./config/bis_gulputils'),
      eslint = require('gulp-eslint');



// ------------------------------------ Utility Functions ---------------------------------------------


// -----------------------------------------------------------------------------------------
// Command Line stuff 
// -----------------------------------------------------------------------------------------

program
    .option('-i, --input <s>','mainscript to build')
    .option('-m, --minify <s>','flag to minify 1=minify 0=regular + sourcemaps,-1 = fast, no sourcemaps')
    .option('-l, --platform  <s>','platform')
    .option('-d, --debug <s>','debug')
    .option('-p, --dopack <s>','dopackage 0=no, 1=electron-packager, 2=run inno or zip in addition')
    .option('-z, --dozip <s>','dozip')
    .option('-n, --internal <n>','if 1 use internal code, if 2 serve the internal directory as well',parseInt)
    .option('-e, --eslint <n>','if 1 use eslint instead of jshint',parseInt)
    .option('-w, --worker <n>','if 1 build the webworker as well',parseInt)
    .option('-s, --sworker <n>','if 1 build the service worker and index.js as well',parseInt)
    .option('--light <n>','if 1 only build the main bislib.js library',parseInt)
    .parse(process.argv);



let options = {
    inpfilename : program.input || "all",
    minify : parseInt(program.minify || 0 ),
    outdir : "build/web",
    distdir : "build/dist",
    debug : parseInt(program.debug || 0),
    platform : program.platform || os.platform(),
    package : program.dopack || 0,
    zip : program.dozip || 0,
    webworker : program.worker || 0,
    eslint : program.eslint || 0,
    sworker : program.sworker || 0,
    internal : parseInt(program.internal || 0) || 0,
};

const mainoption=program.rawArgs[2];

// -----------------------------------------------------------------------------------------
// Install and Zip Issues
// Second pass to help with gulp zip and gulp package
// -----------------------------------------------------------------------------------------
if (mainoption=="zip")
    options.zip=1;
if (mainoption=="package" && options.package===0)
    options.package=2;


options.baseoutput=".";
options.outdir+="/";

let plat=options.platform;
if (plat==='all') {
    plat=[ 'win32','linux'];
    if (os.platform()!=='win32')
        plat.push("darwin");
} else {
    plat=options.platform.split(",");
}
options.platform=plat;


if (options.debug!==0) {
    console.log(bis_gutil.getTime()+' Full options ='+JSON.stringify(options)+'.\n');
}

// -----------------------------------------------------------------------------------------
// M A I N  P R O G R A M Set internal structure with all parameters
// -----------------------------------------------------------------------------------------

let internal = {
    dependcss : [ 
        "./lib/css/bootstrap_dark_edited.css", 
        "./lib/css/bootstrap-colorselector.css",
        "./web/biscommon.css"
    ],
    myscripts : [ 'js/*.js',
                  'js/bin/*.js',
                  'js/cloud/*.js' ,
                  'js/core/*.js',
                  'js/dataobjects/*.js',
                  'js/legacy/*.js',
                  'js/modules/*.js',
                  'js/node/*.js' ,
                  'js/scripts/*.js' ,
                  'js/webcomponents/*js',
                  'js/coreweb/*.js',
                  'test/*.js' ],
    toolarray : [ 'index'],
    htmlcounter : 0,
    csscounter  : 0,
    jscounter   : 0,
    bislib     : 'bislib.js',
    biscss     : 'bislib.css',
    indexlib   : 'index.js',
    serviceworkerlib : 'bisweb-sw.js',
    webworkerlib  : 'webworkermain.js',
    serveroptions : { }
};


// Define server options
internal.serveroptions = {
    "root" : path.normalize(__dirname)
};

if (options.internal) {

    if (options.internal>2) {
        internal.serveroptions = {
            "root" : path.normalize(path.resolve(__dirname,'..'))
        };
    }
    internal.myscripts.push('../internal/js/*/*.js');
    internal.myscripts.push('../internal/js/*.js');
    
}


// ---------------------------
// Get Tool List
// ---------------------------

internal.setup=require('./web/images/tools.json');
let keys=Object.keys(internal.setup.tools);
console.log(bis_gutil.getTime()+colors.cyan(' Config versiontag='+bis_gutil.getVersionTag(internal.setup.version)+' tools='+keys));

if (options.inpfilename === "" || options.inpfilename === "all") {
    let obj=internal.setup.tools;
    let keys=Object.keys(obj);
    options.inpfilename ='index,'+keys.join(",");
} 

// ------------------------
// Define webpack jobs
// ------------------------

if (mainoption==="build") {
    options.sworker=1;
    options.webworker=1;
}


internal.webpackjobs = [ { path: './js/webcomponents/' , name: internal.bislib } ];
if (options.inpfilename === 'index') {
    internal.webpackjobs=[];
}

console.log(colors.red('Sworker='+options.sworker));

if (options.sworker) {
    internal.webpackjobs.push({ path: './web/' ,  name : internal.indexlib });
    internal.webpackjobs.push({ path: './web/' ,  name : internal.serviceworkerlib });
}

if (options.webworker) {
    internal.webpackjobs.push(
        { path : "./js/webworker/",
          name : internal.webworkerlib,
        });
}

// -------------------------------
// Debug Info
// -------------------------------

if (options.debug!==0) {
    console.log(bis_gutil().getTime()+' read tool descriptions from '+colors.cyan(internal.tooldescriptionfile));
    console.log(bis_gutil().getTime()+' Scripts to process are '+colors.cyan(options.inpfilename));
}

// ------------------------------- ------------------------------- -------------------------------
//
// Preliminaries Over
//
// Define Tasks
//
// ------------------------------- ------------------------------- -------------------------------

// ------------------ JSHint ------------------
gulp.task('jshint', function() {
    bis_gutil.jsHint(internal.myscripts);
});

gulp.task('eslint', () => {
    // ESLint ignores files with "node_modules" paths.
    // So, it's best to have gulp ignore the directory as well.
    // Also, Be sure to return the stream from the task;
    // Otherwise, the task may end before the stream has finished.
    return gulp.src(['js/**/*.js','config/*.js','compiletools/*.js','*.js','!node_modules/**'])
    // eslint() attaches the lint output to the "eslint" property
    // of the file object so it can be used by other modules.
        .pipe(eslint({
            globals: [
                'jQuery',
                '$'
            ],
        }))
    // eslint.format() outputs the lint results to the console.
    // Alternatively use eslint.formatEach() (see Docs).
        .pipe(eslint.format());
    // To have the process exit with an error code (1) on
    // lint error, return the stream and pipe to failAfterError last.

});

gulp.task('linter', function(callback) {
    if (options.eslint)
        runSequence('eslint',callback);
    else
        runSequence('jshint',callback);
});


gulp.task('watch',function() {
    gulp.watch(internal.watchscripts, ['linter']);
});


gulp.task('make', function(done) {
    bis_gutil.executeCommand("make ",__dirname+"/build/wasm",done);
});

// ------------------------------------------------------------------------

gulp.task('singleHTML', function() {

    let jsname =internal.bislib;
    if (internal.htmlcounter===0)
        jsname=internal.indexlib;
    
    let out=bis_gutil.createHTML(internal.toolarray[internal.htmlcounter],options.outdir,jsname,internal.biscss);
    internal.htmlcounter+=1;
    return out;
});


gulp.task('singleCSS', function() {
    let toolname=internal.toolarray[internal.csscounter];
    let maincss    = './web/'+toolname+'.css';
    internal.csscounter+=1;
    bis_gutil.createCSSCommon([maincss],toolname+'.css',options.outdir);
});

gulp.task('date', function() {
    bis_gutil.createDateFile(path.resolve(options.outdir,'bisdate.json'));
    bis_gutil.createDateFile(path.resolve(options.outdir,'../wasm/bisdate.js'));
});

gulp.task('webpack', function(done) {

    runSequence('date', ( () => { 
        bis_gutil.runWebpack(internal.webpackjobs,
                             options.internal,
                             __dirname,
                             options.minify,
                             options.outdir,0).then( () => {
                                 console.log(bis_gutil.getTime()+' webpack done num jobs=',internal.webpackjobs.length);
                                 done();
                             });
    }));
});


gulp.task('buildtest',function() {

    let testoutdir=path.resolve(path.join(options.outdir,'test'));
    console.log('Test output dir=',testoutdir);
    gulp.src(['./test/testdata/**/*']).pipe(gulp.dest(testoutdir+'/testdata'));
    gulp.src('./test/module_tests.json').pipe(gulp.dest(testoutdir));
    bis_gutil.createHTML('biswebtest',options.outdir,'bislib.js',internal.biscss);
    let maincss    = './web/biswebtest.css';
    bis_gutil.createCSSCommon([maincss],'biswebtest.css',options.outdir);

});


gulp.task('css', function() {
    bis_gutil.createCSSCommon(internal.dependcss,internal.biscss,options.outdir);
});

gulp.task('serve', function() {
    connect.server(internal.serveroptions);
    console.log('++++ Server root directory=',internal.serveroptions.root);

    for (let i=0;i<internal.myscripts.length;i++) {
        gulp.watch(internal.myscripts[i], ['linter']);
    }

    bis_gutil.createDateFile(path.resolve(options.outdir,'../wasm/bisdate.js'));
    //    bis_gutil.createDateFile(path.resolve(options.outdir,'../web/bisdate.json',1));

    bis_gutil.runWebpack(internal.webpackjobs,
                         options.internal,
                         __dirname,
                         options.minify,
                         options.outdir,1).then( () => {
                             console.log('webpack killed');
                         });
});


gulp.task('server', function() {
    connect.server(internal.serveroptions);
    console.log('++++ Server root directory=',internal.serveroptions.root);
});


gulp.task('commonfiles', function() {
    console.log(bis_gutil.getTime()+' Copying css,fonts,images etc. .');
    gulp.src([ 'node_modules/bootstrap/dist/css/*']).pipe(gulp.dest(options.outdir+'css/'));
    gulp.src([ 'node_modules/bootstrap/dist/fonts/*']).pipe(gulp.dest(options.outdir+'fonts/'));
    gulp.src([ 'web/images/**/*']).pipe(gulp.dest(options.outdir+'/images/'));
    gulp.src('./web/biswebdropbox.html').pipe(gulp.dest(options.outdir));
    gulp.src('./web/onedriveredirect.html').pipe(gulp.dest(options.outdir));
    gulp.src([ 'lib/fonts/*']).pipe(gulp.dest(options.outdir+'/fonts/'));
    gulp.src([ 'web/manifest.json']).pipe(gulp.dest(options.outdir));
    gulp.src('./web/bispreload.js').pipe(gulp.dest(options.outdir));
    gulp.src('./web/biselectron.js').pipe(gulp.dest(options.outdir));
    gulp.src('./web/bislist.txt').pipe(gulp.dest(options.outdir));
    gulp.src('./web/package.json').pipe(gulp.dest(options.outdir));
    gulp.src('./lib/css/bootstrap_dark_edited.css').pipe(gulp.dest(options.outdir));
    gulp.src('./lib/js/webcomponents-lite.js').pipe(gulp.dest(options.outdir));
    gulp.src('./node_modules/jquery/dist/jquery.min.js').pipe(gulp.dest(options.outdir));
    gulp.src('./node_modules/bootstrap/dist/js/bootstrap.min.js').pipe(gulp.dest(options.outdir));
    bis_gutil.createHTML('console',options.outdir,'',internal.biscss);
});

gulp.task('tools', function(done) {
    internal.toolarray = options.inpfilename.split(",");
    console.log(bis_gutil.getTime()+colors.green(' Building tools ['+internal.toolarray+']'));
    let index=-1;
    let nexttool=function() {
        index=index+1;
        if (index<internal.toolarray.length) {
            console.log(bis_gutil.getTime()+colors.green(' Building tool '+(index+1)+'/'+internal.toolarray.length+' : '+internal.toolarray[index]));
            internal.jscounter+=1;
            runSequence('singleHTML','singleCSS',nexttool);
        } else {
            done();
        }
    };
    runSequence('webpack','css',nexttool);
});

gulp.task('build', function(callback) {

    runSequence('commonfiles',
                'tools',
                'buildtest',
                callback);
});

gulp.task('zip', function() {

    bis_gutil.createZIPFile(options.zip,options.baseoutput,options.outdir,internal.setup.version,options.distdir);
});

gulp.task('package2', function(done) {


    
    bis_gutil.createPackage(options.package,
                            internal.setup.tools,
                            __dirname,options.outdir,internal.setup.version,options.platform,options.distdir,done);
});

gulp.task('package', function(done) {
    runSequence('build',
                'package2',
                done);
});


gulp.task('clean', function() {

    let cleanfiles = function() {
        let arr = [options.outdir+'#*',
                   options.outdir+'*~',
                   options.outdir+'*.js*',
                   options.outdir+'*.wasm',
                   options.outdir+'*.png',
                   options.outdir+'*.html*',
                   options.outdir+'*.css*',
                   options.outdir+'css/*',
                   options.outdir+'fonts/*',
                   options.outdir+'images/*',
                   options.outdir+'doc/*',
                   options.outdir+'node_modules',
                   options.outdir+'test',
                   options.distdir+"/*",
                  ];
        
        console.log(bis_gutil.getTime()+' Cleaning files ***** .');
        return del(arr);
    };
    return cleanfiles();
});

gulp.task('jsdoc', function(done) {
    bis_gutil.jsDOC(__dirname,'config/jsdoc_conf.json',done);
});

gulp.task('cdoc', function(done) {
    bis_gutil.doxygen(__dirname,'config/Doxyfile',done);
});

gulp.task('doc', function(done) {
    runSequence('jsdoc','cdoc',done);

});

gulp.task('default', function(callback) {
    runSequence('build',callback);
});
