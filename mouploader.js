/**
 * Created by Moyu on 16/9/13.
 */

var md5;
if(typeof require === 'function') {
    md5 = require('js-md5')
}


function MoUploader(ops) {

    var default_ops = {
        // chunk Size: byte
        chunkSize: (1<<20) * 5,
        // Number: request Number.
        // Array: files requests.
        // Boolean: open or close Slice, if false, chunkSize don't work.
        request: 3,
        files: [],
        uploadUrl: '/',
        // function: get uploaded pos.
        // arguments: file, md5, index.
        // need return a promise object which will return uploaded pos.
        onContinue: null,
        // if false, md5 will be setted by filename.
        md5: true,
        // md5Size: slice file 0 - md5Size for calculate md5
        md5Size: (1<<20) * 50,
        // called when before upload.
        // arguments: file index or -1 (will begin upload)
        onBeforeUpload: null,
        // function: uploading progress listener.
        // *only listen one request.*
        // arguments: index, chunkIndex, chunksNum, loaded, total.
        onProgress: null,
        // function: overall uploading progress listener.
        // arguments: index, loaded, total
        onOverAllProgress: null,
        // function: called when one request is ended.
        // arguments: index, chunkIndex, chunksNum
        onLoad: null,
        // function: called when one request is aborted.
        // arguments: index, chunkIndex, chunksNum
        onAbort: null,
        // function: called when one request happens error.
        // arguments: index, chunkIndex, chunksNum
        onError: null
    }
    
    ops = Object.assign(default_ops, ops);
    var files = Object.assign([], [].slice.call(ops.files))
    var chunkSize = ops.chunkSize;
    var md5Size = ops.md5Size;
    var request = ops.request === true ? 1 : ops.request;

    var __onContinue = ops.onContinue || function () {return new Promise(function (resolve) {resolve(0)});}
    ops.onContinue = function () {
        var args = [].slice.call(arguments)
        return new Promise(function (resolve) {
            __onContinue.apply(null, args)
                .then(function(pos) {
                    var bgBytePos = parseInt(pos);
                    resolve( bgBytePos < 0 ? 0 : bgBytePos)        
                })
        })
    }

    var uploadList = makeUploadProms(files, false)

    ops.onBeforeUpload && ops.onBeforeUpload(-1)

    uploadStart(uploadList, true)


    function uploadStart(uploadList, triggerBeforeUpload, focusIndex) {
        Promise.all(uploadList)
            .then(function (datas) {
                datas.forEach(function (upload, i) {
                    i = focusIndex!=null?focusIndex:i
                    uploadFile(upload, i, triggerBeforeUpload)
                })
            })
    }

    function uploadFile(upload, index, triggerBeforeUpload) {
        var formData = new FormData();

        triggerBeforeUpload && ops.onBeforeUpload && ops.onBeforeUpload(index, formData)

        upload.data &&
        Object.keys(upload.data).forEach(function (x) {
            formData.set(x, upload.data[x])
        })

        if(request !== false) {
            files[index].bg = 0;
            if(request instanceof Array) {
                uploadFileBySlice(upload, request[index], formData, index, upload.data.chunks || 1)
            } else {
                uploadFileBySlice(upload, request, formData, index, upload.data.chunks || 1)
            }
        } else {
            uploadFileBySlice(upload, 1, formData, index, upload.data.chunks || 1)
            // uploadProm(upload.uploads[0], index, -1, 0)
        }
    }

    function getMD5Hex(has, file, size, isMd5Map) {
        return new Promise(function (resolve) {
            if (has) {
                var md5text;
                if(isMd5Map && md5Map[file.name+file.size]) {
                    md5text = md5Map[file.name+file.size]
                    resolve(md5text)
                    return;
                }
                var fr = new FileReader();
                fr.readAsDataURL(file.slice(0, size));

                fr.onload = function (e) {
                    var text = e.target.result;
                    md5text = md5(text)
                    md5Map[file.name+file.size] = md5text
                    resolve(md5text)
                }
            } else {
                resolve(file.name)
            }
        })

    }

    var md5Map = {}

    function makeUploadProms(files, isMd5Map) {
        return files.map(function (file, i) {
            var data = {
                type: file.type,
                lastModified: file.lastModified,
                name: file.name,
            }
            return getMD5Hex(!!ops.md5 && typeof md5 === 'function', file, md5Size, isMd5Map)
                .then(function (md5str) {
                    data.md5 = md5str;
                    return ops.onContinue(file, data.md5, i)
                        .then(function (pos) {
                            var uploads = [], chunkData, dataList = [];
                            var bg = isNaN(pos) ? 0 : Number(pos);
                            var size = file.slice(bg).size;
                            file.upSize = size
                            data.size = size

                            if(request !== false && size/chunkSize > 1) {
                                data.chunks = Math.ceil( size/chunkSize )
                                files[i].bg = 0
                                do {
                                    chunkData = file.slice(bg, bg + chunkSize);
                                    uploads.push(chunkData);
                                    dataList.push({
                                        pos: isNaN(bg) ? 0 : bg,
                                        size: chunkData.size
                                    })
                                    bg += chunkSize;
                                } while(bg < file.size);

                            } else {
                                data.pos = bg
                                chunkData = file.slice(bg)
                                uploads.push(chunkData);
                            }

                            return {
                                data,
                                dataList: dataList,
                                uploads: uploads
                            }
                        })
                })

        });
    }

    files.forEach(function (x) {
        x.bg = 0
    })

    function uploadFileBySlice (upload, request, formData, index, chunksNum) {
        var __fn = arguments.callee;

        var bg = files[index].bg;
        var uploads = upload.uploads;
        var data = upload.data;
        var lists = upload.dataList;
        if(uploads.length === 0) {
            return
        }
        return uploads.splice(0, request)
            .map(function (chunk, i) {
                if(chunksNum > 1) {
                    formData.set('chunk', bg + i)
                    formData.set('pos', lists[bg + i].pos)
                    formData.set('size', lists[bg + i].size)
                }
                formData.set('mo-file', chunk, data.name)

                return uploadProm(formData, index, bg + i, chunksNum)
                    .then(function (val) {
                        if(xhrList[index] && xhrList[index].isPaused) {
                            return;
                        }
                        if(files[index].bg === 0) {
                            files[index].bg += request
                        } else
                            files[index].bg++;
                        return __fn(upload, 1, formData, index, chunksNum)
                    });
            })
    }


    var xhrList = new Array(ops.files.length)

    function uploadProm(data, index, chunkIndex, chunksNum) {

        return new Promise(function (resolve, reject) {

            var xhr = new XMLHttpRequest();

            xhr.upload.addEventListener('progress', function(e) {
                if(!e.lengthComputable) {
                    return;
                }
                // resolve({type: 'progress', xhr: this, index: index})
                xhrList[index].loaded = xhrList[index].loaded || 0
                xhr.loaded = e.loaded
                xhr.total = e.total
                var sums = xhrList[index].reduce(function (p, n) {
                    p[0] += n.loaded || 0;
                    p[1] += n.total || 0;
                    return p;
                }, [(files[index].size - files[index].upSize), 0])
                var otherSize = e.total - data.get('mo-file').size
                if(ops.onOverAllProgress && !xhrList[index].isPaused) {
                    var total =
                        Math.max(
                            xhrList[index].loaded + sums[1] + (files[index].size - files[index].upSize),
                            files[index].size + chunksNum*otherSize
                        );// otherSize*chunksNum;
                    if((sums[0]+xhrList[index].loaded)>total) {
                        total = sums[0]+xhrList[index].loaded
                    }
                    ops.onOverAllProgress(index, sums[0]+xhrList[index].loaded, total, e);
                }
                ops.onProgress && ops.onProgress(index, chunkIndex, chunksNum, e.loaded, e.total, e)
            })
            xhr.addEventListener('load', function (e) {
                resolve({type: 'load', xhr: this, index: index})
                xhrList[index].loaded = xhrList[index].loaded || 0
                var otherSize = this.loaded - data.get('mo-file').size
                xhrList[index].loaded += this.loaded + otherSize;
                xhrList[index][chunkIndex].isLoaded = true
                // if(xhrList[index].every(function (xhr) {return !!xhr.isAborted})) {
                //     xhrList[index].isEnded = true;
                // }

                ops.onLoad && ops.onLoad(index, chunkIndex, chunksNum, e)
            })
            xhr.addEventListener('abort', function (e) {
                resolve({type: 'abort', xhr: this, index: index, data: data})
                xhrList[index][chunkIndex].isAborted = true
                ops.onAbort && ops.onAbort(index, chunkIndex, chunksNum, e)
            })
            xhr.addEventListener('error', function (e) {
                resolve({type: 'error', xhr: this, index: index, data: data})
                xhrList[index][chunkIndex].isAborted = true
                ops.onError && ops.onError(index, chunkIndex, chunksNum, e)
            })

            xhr.open('POST', ops.uploadUrl, true);
            // xhr.setRequestHeader('Content-Type', 'multipart/form-data');
            xhr.send(data);

            xhrList[index] = xhrList[index] || new Array(chunksNum)
            xhrList[index][chunkIndex] = xhr
        })
    }


    return {
        pause: function (index) {
            if(index >= 0) {
                if(xhrList[index]) {
                    xhrList[index].isPaused = true
                    xhrList[index].forEach(function (xhr) {
                        if(xhr) {
                            xhr.abort()
                        }
                    })
                }
            } else {
                var self = this;
                xhrList.forEach(function (x, i) {
                    self.pause(i)
                })
            }
        },
        continue: function (index) {
            if(index >= 0) {
                if(xhrList[index].isPaused/* && !xhrList[index].isEnded*/) {
                    xhrList[index] = [];
                    uploadStart(makeUploadProms([files[index]], true), false, index)
                }
            } else {
                var self = this;
                xhrList.forEach(function (x, i) {
                    self.continue(i)
                })
            }
        }
    }
}

if(typeof define === 'function') {
    define('MoUploader', MoUploader)
}

if(typeof module !== 'undefined' && module.exports) {
    module.exports = MoUploader;
}