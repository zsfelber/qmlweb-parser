# QML parser in JavaScript

[![Join the chat at https://gitter.im/qmlweb/qmlweb](https://badges.gitter.im/qmlweb/qmlweb.svg)](https://gitter.im/qmlweb/qmlweb)
[![Build Status](https://travis-ci.org/qmlweb/qmlweb-parser.svg?branch=master)](https://travis-ci.org/qmlweb/qmlweb-parser)
[![codecov](https://codecov.io/gh/qmlweb/qmlweb-parser/branch/master/graph/badge.svg)](https://codecov.io/gh/qmlweb/qmlweb-parser)

[![npm](https://img.shields.io/npm/v/qmlweb-parser.svg)](https://www.npmjs.com/package/qmlweb-parser)
[![GitHub tag](https://img.shields.io/github/tag/qmlweb/qmlweb-parser.svg)](https://github.com/qmlweb/qmlweb-parser/releases)

This is a QML parser in pure JavaScript, based on UglifyJS parser.

It serves both as an optional dependency to
[QmlWeb](https://github.com/qmlweb/qmlweb) to allow it parse QML and
JavaScript files in runtime and as a parser that powers
[gulp-qmlweb](https://github.com/qmlweb/gulp-qmlweb) to pre-parse
files before serving them to the browser.

## License

QmlWeb parser is licensed under the BSD-2-Clause license, see
[LICENSE](https://github.com/qmlweb/qmlweb-parser/blob/master/LICENSE).


## This Fork/Branch

My version of engine is a medium deep rewrite of original, it is faster and has cleaner code. (as soon as it's ready)

Intended to fix parse errors (like that of readonly property) and maybe another simple bugs which prevent my actual qml model to be compiled and used..

Added:
[readonly]  [list<xxx> templates]   [var xxx = {"aaa:" : <expression>}  json like var property syntax ]

See also [@zsfelber/qmlweb](https://github.com/zsfelber/qmlweb)
See also [@zsfelber/gulp-qmlweb](https://github.com/zsfelber/qmlweb-parser)
