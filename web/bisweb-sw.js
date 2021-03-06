const idb=require('idb-keyval');

// idb-store has a key 'mode' with three values
// online  -- no cache
// offline -- can download
// offline-complete -- has downloaded

// --------- First Configuration Info --------------------
const internal =  {
    cachelist : require('./pwa/pwacache.js'),
    name : 'bisweb',
    path : self.location.href.substr(0,self.location.href.lastIndexOf('/')+1),
    updating : false,
    count : {},
    maxcount : {},
    webfirst : true,
};

internal.path2= internal.path+"#";
internal.mainpage=internal.path+"index.html";

internal.pathlength=internal.path.length;
// ------------------- Utility Functions -----------------

let cleanCache=function(keepmode=false) {
    console.log('bisweb-sw: Cleaning cache',internal.name);
    internal.webfirst=true;
    return new Promise( (resolve,reject) => {
        
        let p=[];
        
        if (keepmode===false)
            p.push(idb.set('mode','online'));

        caches.open(internal.name).then(cache => {
            cache.keys().then( (keys) => {
                console.log('bisweb-sw: Removing',keys.length,'files');
                for (let i=0;i<keys.length;i++) {
                    p.push(cache.delete(keys[i]));
                }
            });

            Promise.all(p).then( ()=> {
                cache.keys().then( (keys) => {
                    console.log('bisweb-sw: Cache deleted files left=', keys.length);
                    resolve();
                });
            }).catch( (e) => {
                reject(e);
            });
        });
    });
};


let populateCache=function(msg="Cache Updated",mode='internal') {

    let lst=internal.cachelist[mode];
    console.log(`bisweb-sw: Beginning to  install (cache) ${lst.length} files. Mode=${mode}`);

    let newlst = [ ];
    if (mode==='internal')
        newlst.push(internal.path);
    for (let i=0;i<lst.length;i++) {
        let item=lst[i];
        newlst.push(item);
    }

    internal.webfirst=true;

    return caches.open(internal.name).then(cache => {

        internal.count[mode]=0;
        internal.maxcount[mode]=newlst.length;
        internal.name[mode]=mode;
        let t= new Date().getTime()
        let p=[];
        
        for (let i=0;i<newlst.length;i++) {
            let url=newlst[i];
            let url2=`${url}?t=${t}`;
            p.push(new Promise( (resolve,reject) => {
                
                fetch(url2).then(function(response) {
                    if (!response.ok) {
                        throw new TypeError('bad response status');
                    }
                    cache.put(url, response).then( () => {
                        internal.count[mode]=internal.count[mode]+1;
                        if (mode==='internal')
                            send_message_to_all_clients(`Updating Cache. Downloaded file ${internal.count[mode]}/${internal.maxcount[mode]}`);
                        resolve();
                    }).catch( (e) => {
                        internal.updating=false;
                        reject(e); });
                });
            }));
        }
        
        Promise.all(p).then( () => {
            internal.updating=false;
            if (mode==='internal') {
                console.log('bisweb-sw: Installation (caching) successful');
                idb.set('mode','offline-complete').then( () => {
                    internal.webfirst=false;
                    send_message_to_all_clients(msg);
                    self.skipWaiting()
                });
            }
        });
    });
};


// ----------------- Messaging Functions -----------------

let send_message_to_client=function(client, msg){
    return new Promise(function(resolve, reject){
        var msg_chan = new MessageChannel();

        msg_chan.port1.onmessage = function(event){
            if(event.data.error){
                reject(event.data.error);
            }else{
                resolve(event.data);
            }
        };
        client.postMessage(msg, [msg_chan.port2]);
    });
};

let send_message_to_all_clients=function(msg){
    clients.matchAll().then(clients => {
        clients.forEach(client => {
            send_message_to_client(client, msg).then(m => console.log("bisweb-sw: Received Message: "+m));
        })
    })
};


// ----------------- Event Handling ----------------------


// -------------------------
// Message from Client
// -------------------------
self.addEventListener('message', (msg) => {
    
    console.log('bisweb-sw: Received message=',msg.data, ' webfirst=',internal.webfirst);
    
    try {
        let obj=JSON.parse(msg.data);
        let name=obj.name;
        let data=obj.data;
        console.log(`bisweb-sw: Received ${name}:${data}`);
        if (name==="updateCache") {
            if (internal.updating===false) {
                internal.updating=true;
                populateCache('Cache Updated','internal');
                populateCache('Cache Updated','external');
            } else {
                console.log('bisweb-sw: Already updating cache');
            }
        } else if (name==="clearCache") {
            cleanCache().then( () => { send_message_to_all_clients(`Cleaned Cache. Disabled offline capabilities`); });
        }
    } catch(e) {
        console.log(`bisweb-sw: Bad Message ${e} received`);
    }
    
});

// -------------------------
// Install Event
// -------------------------
self.addEventListener('install', e => {

    internal.webfirst=true;
    idb.get('mode').then( (m) => {
        m=m || '';
        if (m!=='online') {
            cleanCache(true).then( () => {
                send_message_to_all_clients(`NewSW -- Due to Major Updatehe Cache was emptied.`);
                self.skipWaiting()
            });
        } 
    });
});

// -------------------------
// Activate Event
// -------------------------
self.addEventListener('activate',  event => {

    event.waitUntil(self.clients.claim());
    self.skipWaiting()
    idb.get('mode').then( (m) => {
        console.log('in activate mode=',m);
        if (m!=='online')
            idb.set('mode','online').then( () => {
                send_message_to_all_clients(`NewSW -- Due to Major Updatehe Cache was emptied.`);
            });
    });
});

// -------------------------
// The Critical Fetch Event
// -------------------------

self.addEventListener('fetch', event => {

    let webfirst=internal.webfirst;

    if (!webfirst) {
    
        let url=event.request.url;
        if (url.indexOf('bisdate.json')>=0)
            webfirst=true;
        
        
        if (internal.updating)
            webfirst=true;
    }

    

    if (webfirst) {
        event.respondWith(fetch(event.request).catch( (e) => {
            console.log('bisweb-sw: Tried but no network ... returning cached version',event.request.url);
            return caches.match(event.request);
        }));
        return;
    }

    // Cache then Web
    let url=event.request;
    if (event.request.url === internal.path || event.request.url === internal.path2) {
        url=internal.mainpage;
    }
    
    event.respondWith(
        caches.match(url, {ignoreSearch : true}).then( (response) => {
            if (response) {
                return response;
            }
            return fetch(event.request);/*.then( (response) => {
                caches.open(internal.name).then( (cache) => { 
                    cache.put(event.request, response);
                });
                }*/
        }).catch( (e) => {
            console.log('bisweb-sw: Cache fetch failed; returning online version for', event.request.url,e);
        })
    );

    
});

console.log(`bisweb-sw: BioImage Suite Web Service Worker starting name=${internal.name} path=${internal.path}`);                       
