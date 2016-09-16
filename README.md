# 分片上传与断点续传解决方案

上传文件，基本上是每一个网站应用都会具备的一个功能。对于一个网络存储应用，对于上传功能要求更是迫切。  
如今市面上成熟上传插件，如`WebUploader`，"体积太大"，不适合于移动端上传；再加上作为一位程序员的"操守"，当然还是更喜欢自己造轮子。

于是花了一天半时间，`MoUploader`应运而生。为什么叫`MoUploader`呢？  
`Mo`表示`Mobile`(其实更是因为我的绰号moyu)

<!--more-->

## 关于实现原理

- 首先需要明确，上传这东西不仅仅是只需要前端就能完成的很好的，需要前端后端统一数据格式，从而实现断点续传。（所以，该文适合于全栈工程师，至少是想成为）
- 还有，为什么需要分片，不分片能实现断点续传吗？分片是为了充分利用网络带宽，加快上传速度；不分片也是能够实现断点续传的。详细参考 [HTML5文件上传组件深度剖析](http://fex.baidu.com/blog/2014/04/html5-uploader/).   
分片上传与断点续传之间没有很直接的关系.

 好了，进入正题
    - 实现断点续传的前提是需要服务器记录某文件的上传进度，那么根据什么判断是不是同一个文件呢？可以利用文件内容求md5码，如果文件过大，求取md5码也是一个很长的过程，所以对于大文件，只能针对某一段数据进行计算，加上服务器对cookie用户信息的判断，得到相对唯一的key
    
    - 在前端页面，需要将文件按照一定大小进行分片，一次请求只发送这一小片数据，所以我们可以同时发起多个请求。但一次同时请求的连接数不宜过多，服务器负载过重
    
    对于文件分片操作，H5具有十分强大的File API，直接利用File对象的slice方法即可得到Blob对象.  
    至于同时传输数据的连接数控制逻辑，就需要花点脑子思考了

    - 前端把数据顺利得传给服务器了，服务器只需要按照数据中给的开始字节位置，与读取到的文件片段数据，写入文件即可
 
 更多信息就看源码吧！[MoUploader](https://github.com/moyuyc/moUploader)
 
## 功能实现

- 文件结构

```
file-upload/
├── bower_components/ # bower包
├── db.js   # 数据操作接口
├── demo.html
├── md5.json # 数据
├── mouploader.js # 源码
├── README.md 
└── server.js # demo.html服务, 建立在4040端口

1 directories, 8 files.
```
(打印文件目录树使用的是自己写的[print-dir](https://github.com/moyuyc/directory-tree))

- 怎么使用

    1. 引入script，amd/cmd/...，
    2. 使用MoUploader
    ```js
    input.onchange = function (e) {
        var self = this;
        var moUploader = MoUploader({ 
            files: this.files,
            uploadUrl: '/upload',
            request: false,
            onBeforeUpload: function (index) {
                if(index>=0) {
                    self.files[index].progress = appendUploading(self.files[index], index)
                }
            },
            onOverAllProgress: function (index, loaded, total) {
                console.log(loaded / total)
                //setProgress(loaded / total, self.files[index].progress)
            },
            onLoad: function (index, chunkIndex, chunksNum) {
                console.log('onLoad', this, arguments)
            },
            onAbort: function (index, chunkIndex, chunksNum) {
                console.log('onAbort', this, arguments)
            },
            onError: function (index, chunkIndex, chunksNum) {
                console.log('onError', this, arguments)
            },
            onContinue: function (file, md5, index) {
                return new Promise(function(reslove, reject) {
                    var xhr = new XMLHttpRequest()
                    xhr.open('GET', '/getFile?md5='+md5, true);
                    xhr.send(null);
                    xhr.addEventListener('readystatechange', function () {
                        if(xhr.readyState === 4 && xhr.status === 200) {
                            var json = JSON.parse(xhr.responseText);
                            log(json)
                            reslove(json.pos)
                        }
                    })
                })
            }
        })
        
        // pause or continue upload
        // if index < 0, will run for all files
        // moUploader.pause(index);
        // moUploader.continue(index);    
    }
    
    ```
    
    3. 配置选项
    ```js
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
    
    ```
    
    4. 服务器数据处理 (Node.js)
    
    数据分段写入文件
    ```js
    function writeBuffer(bf, path, pos) {
        var fd = fs.openSync(path, 'a+');
        fs.writeSync(fd, bf, 0, bf.length, Number(pos) || 0)
        console.log(`write buffer, pos: ${pos}, path: ${path}, length: ${bf.length}`)
    }
    
    function store(param, chunks) {
        param.chunks = param.chunks || 1
        param.chunk = param.chunk || 0
        var p = path.join('./upload', param.name)
        var bf = Buffer.concat(chunks);

        var json = db.get(param.md5);
        if(json) {
            json.pos = parseInt(json.pos!=null?json.pos : 0)
            json.size = parseInt(json.size!=null?json.size : 0)
        }
        if(!json || (json.pos+json.size) <= param.pos) {
            // 新的数据pos比数据库中大，更新数据
            param.size = bf.length
            db.set(param.md5, param)
            db.save();
            writeBuffer(bf, p, param.pos || 0)
        }
    }
    
    var multiparty = require('multiparty')
    var form = new multiparty.Form({
        autoFields: true,
        autoFiles: false,
    });
    
    form.on('part', (part) => {
        form.on('aborted', () => {
            //意外退出或者暂停都会保存数据
            console.log('aborted');
            store(param, chunks)
        })

        var chunks = []
        part.on('data', (data) => {
            if(part.filename) {
                chunks.push(data)
            }
        }).on('end', () => {
            console.log('end')
            store(param, chunks)
        })

    });
    form.on('field', (name, value) => {
        param[name] = value;
    });
    ```
    
