# module-coverage

Displays information about module coverage (on a webpack bundle) using Code Coverage report from Chrome DevTools.


## Usage

### Pre-requisites
This assume your bundle (split into one or more chunks) will have the structure:

```
(window.webpackJsonp = window.webpackJsonp || []).push([[<id>], {
    "<module-name-1>": function() {...},
    "<module-name-2>": function() {...},
    ...
})
```

It works best if `module-name-1` is not hashed (i.e. if you use `moduleId: "named"`) in webpack config.

### Running the tool

1. Generate the code coverage from Chrome Dev Tools (see https://developer.chrome.com/docs/devtools/coverage/)
2. Export it as a JSON
3. Run `yarn dlx module-coverage -f <json-report-path>`


### Getting size info

Optionally, you can also display the size information of unused modules. Please note this will desplay the raw unminified, uncompressed size.

This works by specifying the root of your projects, where your `node_modules` are.

```
yarn dlx module-coverage -f <json-report-path> -r <root>
```


## Details

This tool will look for the AST path `Program > ExpressionStatement > CallExpression > ArrayExpression > ObjectExpression`, and expect that object to have module names as keys, and their implementation as values.

Then it will extract the ranges from the Code Coverage report, and interset those ranges with the AST mentioned above to determine if there is an overlapping range with the module implementation. If there is not, it will mark that module as unused.