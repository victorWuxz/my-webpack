let path = require('path')
let fs = require('fs')
var mkdirp = require('mkdirp');
let babylon = require('babylon')//可以将js语法解析成ast语法树
let t = require('@babel/types')
let traverse = require('@babel/traverse').default//可以遍历ast并且负责替换、移除和添加节点
let generator = require('@babel/generator').default// Babel 的代码生成器，它读取AST并将其转换为代码和源码映射
let ejs = require('ejs')
let {SyncHook} = require('tapable')
class Compiler{
  constructor(config){
    this.config = config
    //用来保存文件的入口
    this.entryId
    //需要保存所有模块依赖
    this.modules = {}
    //入口路径
    this.entry = config.entry
    //工作目录
    this.root = process.cwd()
    this.hooks = {
      entryOption:new SyncHook(),
      compile:new SyncHook(),
      afterCompile:new SyncHook(),
      afterPlugins:new SyncHook(),
      run:new SyncHook(),
      emit:new SyncHook(),
      done:new SyncHook()
    }
    //如果传递了plugins参数
    let plugins = this.config.plugins
    if(Array.isArray(plugins)){
      plugins.forEach(plugin => {
        plugin.apply(this)
      })
    }
    this.hooks.afterPlugins.call()
  }
  getSource(modulePath){
    let content = fs.readFileSync(modulePath,'utf8')
    //loader配置
    let rules = this.config.module.rules
    rules.forEach(rule => {
      let {test,use} = rule
      let len = use.length - 1
      if(test.test(modulePath)){
        function normalLoader(){
          let loader = require(use[len--])
          content = loader(content)
          if(len>=0){
            normalLoader()
          }
        }
        normalLoader()
      }
    })
    return content
  }
  parse(source,parentPath){
    //解析代码，AST语法树
    let ast = babylon.parse(source)
    let dependencies = []
    traverse(ast,{
      CallExpression(p){
        let node = p.node
        if(node.callee.name === 'require'){
          node.callee.name = 'mypack_require'
          let moduleName = node.arguments[0].value //require引用模块的名字
          moduleName = moduleName + (path.extname(moduleName) ? '' : '.js')
          moduleName = './' + path.join(parentPath,moduleName)
          dependencies.push(moduleName)
          node.arguments = [t.stringLiteral(moduleName)]
        }
      }
    })
    let sourceCode = generator(ast).code
    return {sourceCode,dependencies}
  }
  buildModule(modulePath,isEntry){
    let source = this.getSource(modulePath)
    let moduleName = './' + path.relative(this.root,modulePath)
    if(isEntry){
      this.entryId = moduleName
    }
    let { sourceCode,dependencies } = this.parse(source,path.dirname(moduleName))
    this.modules[moduleName] = sourceCode
    dependencies.forEach(dep => { //附属模块的递归加载
      this.buildModule(path.join(this.root,dep),false)
    })
  }
  emitFile(){
    //用数据渲染我们的模板
    let main = path.join(this.config.output.path,this.config.output.filename)
    //模板路径
    let templateStr = this.getSource(path.join(__dirname,'./main.ejs'))
    let code = ejs.render(templateStr,{
      entryId:this.entryId,
      modules:this.modules
    })
    this.assets ={}
    this.assets[main] = code
    mkdirp(path.dirname(main),err => {
      if(err) return
      fs.writeFileSync(main,this.assets[main],{
        flag:'w',
        encoding:'utf8'
      })
    })
    
  }
  run(){
    this.hooks.run.call()
    this.hooks.compile.call()
    //执行并创建模块的依赖关系
    this.buildModule(path.resolve(this.root,this.entry),true)
    this.hooks.afterCompile.call()
    this.emitFile()
    this.hooks.emit.call()
    this.hooks.done.call()
  }
}
module.exports = Compiler