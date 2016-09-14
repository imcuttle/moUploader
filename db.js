/**
 * Created by Moyu on 16/9/13.
 */

var fs = require('fs')

const PATH = './md5.json'

var md5 = require(PATH)
md5 = md5 || {}

module.exports = {
    save: function () {
        fs.writeFileSync(PATH, JSON.stringify(md5, null, 4))
    },
    set: function (key, value) {
        if(!key || key == 'undefined') {return}
        md5[key] = value
    },
    get: function (key) {
        return md5[key];
    }
}