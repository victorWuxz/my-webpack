#!/usr/bin/env node
let path = require('path')
//配置文件，webpack.config.js
let config = require(path.resolve('mypack.config.js'))
//编译模块
let Compiler = require('../lib/Compiler')
let compiler = new Compiler(config)
compiler.hooks.entryOption.call()
compiler.run()