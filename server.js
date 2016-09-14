/**
 * Created by Moyu on 16/8/29.
 */

var http = require('http')
var fs = require('fs')
var multiparty = require('multiparty')
var path = require('path')
var URL = require('url')

var db = require('./db')

var server = http.createServer(function (req, res) {
    console.log(req.url)
    if(req.url == '/') {
        fs.readFile('./demo.html', (err, data) => {
            if(err) {
                res.end(err.message)
            } else {
                res.end(data.toString())
            }
        })
        return;
    }

    if(req.url == '/upload') {
        // req.setEncoding(null)
        // console.log(req.headers['Content-Disposition'])
        req.on('data', (chunk) => {
            // console.log(chunk.toString())
        })
        var param = {}
        var form = makeForm(param)
        form.on('close', () => {
            res.end();

            console.log(param)
            var _md5 = param.md5;
            delete param.md5;
            if(_md5) {
                db.set(_md5, param)
                db.save();
            }

        })
        form.parse(req)
        return;
    }

    if(req.url.startsWith('/getFile')) {
        var query = URL.parse(req.url, true).query
        var _md5 = query.md5;

        var data = db.get(_md5);
        if(data) {
            res.end(JSON.stringify({code: 200, pos: parseInt(data.pos) + parseInt(data.size)}))
        } else {
            res.end(JSON.stringify({code: 404, pos: 0}))
        }
    }

    req.setTimeout(2000);

    var read = fs.createReadStream('.' + req.url)
    read.pipe(res)
    read.on('error', err=>console.error)
}).on('error', (er) => console.error)
.listen(3000)

server.on('close', () => {
    console.log('closed');
    db.save()
})
process.on('uncaughtException', function(err) {
    console.error(err)
})

process.on('SIGINT', function() {
    server.close();
});

var dataMap = {}

function writeBuffer(bf, path, pos) {
    var fd = fs.openSync(path, 'a+');
    fs.writeSync(fd, bf, 0, bf.length, Number(pos) || 0)
    console.log(`write buffer, pos: ${pos}, path: ${path}, length: ${bf.length}`)
}

function makeForm(param) {
    //生成multiparty对象，并配置上传目标路径
    var form = new multiparty.Form({
        autoFields: true,
        autoFiles: false,
    });

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
            param.size = bf.length
            db.set(param.md5, param)
            db.save();
            writeBuffer(bf, p, param.pos || 0)
        }
    }
    form.on('progress', (bytesReceived, bytesExpected) => {
        // console.log(bytesReceived/bytesExpected)
    })
    form.on('error', (er) => console.error)
    form.on('part', (part) => {
        form.on('aborted', () => {
            console.log('aborted')
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

            /*
             dataMap[param.md5] = dataMap[param.md5] || {}
             var obj = dataMap[param.md5]
             obj[param.chunk] = bf;
            if(Object.keys(obj).length == param.chunks) {
                fs.open(p, 'w+', function(err, fd) {
                    if (err) {
                        throw 'error opening file: ' + err;
                    }
                    var buff = Buffer.concat(Object.keys(obj).map(k=> obj[k]))
                    console.log(buff)
                    fs.write(fd, buff, 0, buff.length, null, function(err) {
                        if (err) throw 'error writing file: ' + err;
                        fs.close(fd, function() {
                            console.log('file written');
                        })
                    });
                });
                delete dataMap[param.md5]
            }
            */

        })

    })
    form.on('field', (name, value)=>{
        param[name] = value;
    });
    return form;
}