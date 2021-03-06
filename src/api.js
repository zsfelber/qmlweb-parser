/* @license

  Copyright (c) 2010 Mihai Bazon <mihai.bazon@gmail.com>
  Copyright (c) 2011 Lauri Paimen <lauri@paimen.info>
  Copyright (c) 2013 Anton Kreuzkamp <akreuzkamp@web.de>
  Copyright (c) 2016 qmlweb-parser contributors
  Based on parse-js (http://marijn.haverbeke.nl/parse-js/).

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions
  are met:

      * Redistributions of source code must retain the above
        copyright notice, this list of conditions and the following
        disclaimer.

      * Redistributions in binary form must reproduce the above
        copyright notice, this list of conditions and the following
        disclaimer in the documentation and/or other materials
        provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDER “AS IS” AND ANY
  EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
  PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE
  LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
  OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
  PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
  PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
  THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
  TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
  THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
  SUCH DAMAGE.
*/

/*
 * QML parser and parsetree'er.
 *
 * Exports:
 *
 * - qmlweb_parse(src, type) -- parses QML source and returns it as output
 *   tree expected by the QML engine
 */

// Object cloning for debug prints.
function clone(obj) {
  if (obj == null || typeof obj !== 'object')
    return obj;

  var temp = {}; // changed

  for (var key in obj)
    temp[key] = clone(obj[key]);
  return temp;
}

function QMLParseError(message, line, col, pos, source) {
  JS_Parse_Error.call(this, message, line, col, pos);
  var comment = extractLinesForErrorDiag(source, line);
  this.comment = comment ? comment : "";
  this.message += " (line: " + this.line + ", col: " + col + ", pos: " + pos + ")" + "\n" + comment + "\n";
  this.file = qmlweb_parse.nowParsingFile;
}
QMLParseError.prototype = new Error();

function extractLinesForErrorDiag(text, line) {
  var r = "";
  var lines = text.split("\n");

  for (var i = line - 3; i <= line + 3; i++) {
    if (i >= 0 && i < lines.length ) {
      var mark = i === line ? ">>" : "  ";
      r += mark + (i + 1) + "  " + lines[i] + "\n";
    }
  }

  return r;
}

function qmlweb_tokenizer($TEXT) {
  // Override UglifyJS methods

  parse_error = function(err) {
    throw new QMLParseError(err, S.tokline, S.tokcol, S.tokpos, S.text);
  };

  // WARNING: Here the original tokenizer() code gets embedded
  return tokenizer($TEXT);
}

function qmlweb_parse($TEXT, document_type, exigent_mode) {
  var embed_tokens = false; // embed_tokens option is not supported
  var block_in_qmlvartype = false;

  var TEXT = $TEXT.replace(/\r\n?|[\n\u2028\u2029]/g, "\n").replace(/^\uFEFF/, '');
  $TEXT = qmlweb_tokenizer($TEXT, true);

  var translate = {};

  // <-------->>                  -6
  //                <<-------->   25
  // <---x---->>      +4
  //    <<----x--->   +12
  // <---x--------x------>> +16
  //    <<-------->         +12
  function leftinter(interv1, interv2) {
    return interv1[1] - interv2[0];
  }

  function intersect(interv1, interv2) {
    var p1 = leftinter(interv1,interv2);
    var p2 = leftinter(interv2,interv1);
    var r;
    if (p1 >= 0 && p2 >= 0) {
      r = [Math.max(interv1[0], interv2[0]), Math.min(interv1[1], interv2[1])];
    }

    return r;
  }

  function replaceIntersect(interv1, interv2, txt) {
    var inters;
    if (inters = intersect(interv1,interv2)) {
      return   TEXT.substring(interv1[0], inters[0]) +
        txt +  TEXT.substring(inters[1],  interv1[1]);
    }
  }

  function copySource(begin, end) {
    var interv1 = [parseInt(begin), parseInt(end)];
    for (var interv2 in translate) {
      interv2 = interv2.split(",");
      interv2[0] = parseInt(interv2[0]);
      interv2[1] = parseInt(interv2[1]);
      var txt = translate[interv2];
      var result = replaceIntersect(interv1, interv2, txt);
      if (result !== undefined) {
        return result;
      }
    }
    return TEXT.substring(begin, end);
  }

  // WARNING: Here the original parse() code gets embedded
  parse($TEXT,exigent_mode,false);
  // NOTE: Don't insert spaces between arguments!

  // Override UglifyJS methods

  croak = function(msg, line, col, pos) {
    var ctx = S.input.context();
    throw new QMLParseError(msg,
                            line != null ? line : ctx.tokline,
                                           col != null ? col : ctx.tokcol,
                                                         pos != null ? pos : ctx.tokpos,
                                                                       TEXT
                            );
  };

  expect_token = function(type, val) {
    if (is(type, val)) {
      return next();
    }
    token_error(S.token, "Unexpected token " + S.token.type + " " + S.token.val + ", expected " + type + " " + val);
  };

  var statement_js = statement;
  statement = function(forw_call) {
    var in_qmlpropdef = !!statement.in_qmlpropdef;
    statement.in_qmlpropdef = false;
    switch (S.token.type) {
    case "punc":
      switch (S.token.value) {
      case ".":
        return is_token(peek(), "name", "pragma") ? qml_pragma_statement() : unexpected();
      case "{":
        if (in_qmlpropdef && is_token(peek(), "string", null)) {
          return qmlblock();
        }
      }
    case "keyword":
      switch (S.token.value) {
      case "function":
        if (in_qmlpropdef) {
          next();
          return function_(false);
        }
      }
    }
    if (forw_call)
      return forw_call();
    else
      return statement_js();
  };

  expr_ops = function (no_in) {
    var leftstart = S.token.pos;
    return expr_op(maybe_unary(true), 0, no_in, leftstart);
  };

  expr_op = function (left, min_prec, no_in, leftstart) {
    var leftend = S.token.pos;
    var op = is("operator") ? S.token.value : null;
    if (op && op == "in" && no_in) op = null;
    var prec = op != null ? PRECEDENCE[op] : null;
    if (prec != null && prec > min_prec) {
      next();
      var rightstart = S.token.pos;
      var right = expr_op(maybe_unary(true), prec, no_in);

      if (op==="instanceof") {
        var rightend = S.token.pos;
        translate[[parseInt(leftstart),parseInt(rightend)]] =
                       "QmlWeb.$instanceOf("+TEXT.substring(leftstart, leftend).trim()+",\""+
                         TEXT.substring(rightstart, rightend).trim()+"\", this.$component)" ;
      }

      return expr_op(as("binary", op, left, right), min_prec, no_in);
    }
    return left;
  };

  array_ = function() {
    var from = S.token.pos;
    var stat = expr_list("]", !exigent_mode, true);
    var to = S.token.pos;
    return as("array", stat, "[" + copySource(from, to));
  };

  expression = function(commas, no_in) {
    if (arguments.length == 0)
      commas = true;
    var expr = maybe_qmlelem(no_in);
    if (commas && is("punc", ",")) {
      next();
      return as("seq", expr, expression(true, no_in));
    }
    return expr;
  };

  function expr_statement() {
    var res = [];
    res.push("stat");
    res.push(expression(false));
    return res;
  }

  // QML-specific methods

  function as_xxx_statement(res, forw_call, forw_forw_call) {
    S.in_function++;
    var start = S.token.pos;
    res.push(forw_call(forw_forw_call));
    var end = S.token.pos;
    S.in_function--;
    res.push(copySource(start, end));
    return res;
  }
  function as_statement() {
    var res = slice(arguments);
    return as_xxx_statement(res,statement);
  }
  function as_statement_js() {
    var res = slice(arguments);
    return as_xxx_statement(res,statement_js);
  }
  function as_expr_statement() {
    var res = slice(arguments);
    return as_xxx_statement(res,statement,expr_statement);
  }

  function maybe_qmlelem(no_in) {
    var expr = maybe_assign(no_in);
    if (is("punc", "{"))
      return as("qmlelem", expr[1], undefined, qmlblock());
    return expr;
  }

  function qml_is_element(name) {
    if (typeof name === "string") {
      return name[0].toUpperCase() === name[0];
    }
    return qml_is_element(name[1]) && name[2][0].toUpperCase() === name[2][0];
  }

  function qmlblockline(a,first) {
    if (is("eof"))
      unexpected();
    a.push(qmlstatement(first));
  }

  function qmlblock() {
    expect("{");
    var a = [];
    var was_qmlvar = block_in_qmlvartype;
    if (!is("punc", "}")) {
      qmlblockline(a,true);
    }
    while (!is("punc", "}")) {
      qmlblockline(a,false);
    }
    block_in_qmlvartype = was_qmlvar;
    expect("}");
    return a;
  }

  function qmlpropdef(readonly) {
    var type = S.token.value;
    next();
    var name, opOrName = S.token.value, templTarg;
    if (S.token.type=="operator" && opOrName=="<") {
      next();
      if (S.token.type=="name") {
        templTarg = S.token.value;
        next();
        opOrName = S.token.value;
        if (S.token.type=="operator" && opOrName==">") {
          next();
          name = S.token.value;
          if (S.token.type!="name") {
            token_error(S.token, "Unexpected token " + S.token.type + " " + S.token.val + ", expected name");
          }
        } else {
          token_error(S.token, "Unexpected token " + S.token.type + " " + S.token.val + ", expected '>'");
        }
      } else {
        token_error(S.token, "Unexpected token " + S.token.type + " " + S.token.val + ", expected name");
      }
    } else {
      name = opOrName;
      if (S.token.type!="name") {
        token_error(S.token, "Unexpected token " + S.token.type + " " + S.token.val + ", expected name");
      }
    }

    next();
    if (type == "alias") {

      expect(":");
      if (!is("name"))
        unexpected();

      var args = [readonly?"qmlaliasdefro":"qmlaliasdef", name];
      var path = [];
      var stack = [];

      for(;;) {
        path.push(S.token.value);

        var forw = peek();
        var ready = 1;
        if (is_token(forw, "punc", ".")) {
          ready = 0;
          next();
          forw = peek();
        } else {
          var any = 0;
          while (is_token(forw, "punc", "]")) {
            next();
            forw = peek();
            if (!stack.length) {
              token_error(S.token, "Unexpected token " + S.token.type + " ']', no starting '['");
            }
            path = stack.pop();
            any = 1;
          }
          if (stack.length) {
            token_error(S.token, "Unexpected token " + S.token.type + " " + S.token.val + ", missing closing ']'");
          }
          while (is_token(forw, "punc", "[")) {
            next();
            forw = peek();
            var op = path;
            stack.push(path);
            op.push(path = []);
            any = 1;
          }
          if (!any) {
            next();
            break;
          }
          ready = !stack.length;
        }
        next();
        if (is_token(forw, "name")) {
        } else {
          if (ready) break;
          else unexpected();
        }
      }
      if (stack.length) {
        token_error(S.token, "Unexpected token " + S.token.type + " " + S.token.val + ", missing closing ']'");
      }
      args = args.concat(path);

      //if (args.length>4) {
      //  console.warn("Alias path length > 2 : "+JSON.stringify(args));
      //}
      return as.apply(this, args);
    }

    if (is("punc", ":")) {
      next();
      statement.in_qmlpropdef = true;
      if (templTarg)
        return as_statement(readonly?"qmlpropdefro":"qmlpropdef", name, type, templTarg);
      else
        return as_statement(readonly?"qmlpropdefro":"qmlpropdef", name, type);
    } else if (!!readonly) {
      token_error(S.token, "Expected ': ...'.");
    } else {
      if (is("punc", ";"))
        next();
      if (templTarg)
        return as(readonly?"qmlpropdefro":"qmlpropdef", name, type, templTarg);
      else
        return as(readonly?"qmlpropdefro":"qmlpropdef", name, type);
    }
  }

  function qmlpropdefro() {
    next();
    expect_token("name", "property");
    return qmlpropdef(true);
  }

  function qmldefaultprop() {
    next();
    expect_token("name", "property");
    return as("qmldefaultprop", qmlpropdef());
  }

  function qmlsignaldef() {
    var name = S.token.value;
    next();
    var args = [];
    if (is("punc", "(")) {
      next();
      var first = true;
      while (!is("punc", ")")) {
        if (first)
          first = false;
        else
          expect(",");
        if (!is("name") && !is('keyword', 'var'))
          unexpected();
        var type = S.token.value;
        next();
        if (!is("name"))
          unexpected();
        args.push({ type: type, name: S.token.value });
        next();
      }
      next();
    }
    if (is("punc", ";"))
      next();
    return as("qmlsignaldef", name, args);
  }

  function qmlstatement(is_block_begin) {
    if (!block_in_qmlvartype) {
      if (is("keyword", "function")) {
        var from = S.token.pos;
        next();
        var stat = function_(true);
        var to = S.token.pos;
        var name = stat[1];
        return as("qmlmethod", name, stat, copySource(from, to));
      } else if (is("name", "signal")) {
        next();
        if (is("punc", ":")) {
          next();
          return as_statement("qmlprop", "signal");
        } else {
          return qmlsignaldef();
        }
      }
    } else if (!is_block_begin) {
      expect(",");
    }

    if (S.token.type == "name") {
      var propname;
      if (!block_in_qmlvartype) {
        if (S.token.value == "readonly" && is_token(peek(), "name", "property")) {
          return qmlpropdefro();
        }
        if (S.token.value == "property" && !is_token(peek(), "punc", ":")) {
          next();
          return qmlpropdef();
        }

        propname = subscripts(as_name(), false);
        if (qml_is_element(propname)) {
          // Element
          var onProp;
          if (is("name", "on")) {
            next();
            onProp = S.token.value;
            next();
          }
          return as("qmlelem", propname, onProp, qmlblock());
        }
      } else {
        propname = subscripts(as_name(), false);
      }

      if (is("punc", "{")) {
        return as("qmlobj", propname, qmlblock());
      } else if (block_in_qmlvartype) {
        // qml block/function/js statement or block
        expect(":");
        statement.in_qmlpropdef = true;
        return as_expr_statement("qmlprop", propname);
      } else {
        // Evaluatable item
        expect(":");
        var prop_matters = propname instanceof Array?propname[propname.length-1]:propname;
        var event_handler = /^on_?[A-Z][a-zA-Z_$0-9]*$/.test(prop_matters);
        // event hanler : js statement or block,  otherwise : qml block/function/js statement or block
        if (event_handler) {
          return as_statement_js("qmlprop", propname);
        } else {
          statement.in_qmlpropdef = true;
          return as_statement("qmlprop", propname);
        }
      }

    } else if (is("keyword", "default")) {
      return qmldefaultprop();
    } else if (S.token.type == "string") {
      if (!!is_block_begin) {
        // "var xxx = { 'var' qml type syntax }"
        block_in_qmlvartype = true;
      }
      if (block_in_qmlvartype) {
        var labelSt = S.token.value;
        next();
        // Evaluatable item
        expect(":");
        statement.in_qmlpropdef = true;
        //return as_expr_statement("qmlprop", S.token.value);
        return as_expr_statement("qmlprop", labelSt);
      } else {
        unexpected();
      }
    } else if (S.token.type == "number"||S.token.type == "operator"||S.token.type == "atom") {
      unexpected();
    } else if (is("punc", ";")) {
      if (block_in_qmlvartype) {
        unexpected();
      } else {
        // just skip semicolon opt
        next();
      }
    } else {
      todo();
    }
  }

  function qml_pragma_statement() {
    next();
    next();
    var pragma = S.token.value;
    next();
    return as("qmlpragma", pragma);
  }

  function qmlimport() {
    // todo
    next();
    var moduleName = S.token.value;
    var isDottedNotation = S.token.type == "name";
    next();

    while (is("punc", ".")) {
      next();
      moduleName += "." + S.token.value;
      next();
    }
    if (is("num")) {
      var version = S.token.value;
      next();
    }
    var namespace = "";
    if (is("name", "as")) {
      next();
      namespace = S.token.value;
      next();
    }
    // need to skip semicolon opt
    if (is("punc", ";"))
      next();
    return as("qmlimport", moduleName, version, namespace, isDottedNotation);
  }

  function qmldocument() {
    var imports = [];
    while (is("name", "import")) {
      imports.push(qmlimport());
    }
    var root = qmlstatement();
    if (!is("eof"))
      unexpected();
    return as("toplevel", imports, root);
  }

  function jsdocument() {
    var statements = [];
    while (!is("eof")) {
      statements.push(statement());
    }
    return as("jsresource", statements);
  }

  function amIn(s) {
    console && console.log(s, clone(S), S.token.type, S.token.value);
  }

  function todo() {
    amIn("todo parse:");
    next();
  }

  if (document_type === qmlweb_parse.JSResource) {
    return jsdocument();
  } else {
    return qmldocument();
  }
}

qmlweb_parse.nowParsingFile = ''; // TODO: make a parameter of qmlweb_parse
qmlweb_parse.QMLDocument = 1;
qmlweb_parse.JSResource = 2;

function qmlweb_jsparse(source) {
  var obj = { pragma: [], exports: [], source: source };
  var AST_Tree = qmlweb_parse(source, qmlweb_parse.JSResource);
  var main_scope = AST_Tree[1];

  for (var i = 0 ; i < main_scope.length ; ++i) {
    var item = main_scope[i];

    switch (item[0]) {
    case "var":
      obj.exports.push(item[1][0][0]);
      break ;
    case "defun":
      obj.exports.push(item[1]);
      break ;
    case "qmlpragma":
      obj.pragma.push(item[1]);
      break ;
    }
  }
  return obj;
}

if (typeof module !== 'undefined' && module.exports) {
  // Node.js
  module.exports.parse = qmlweb_parse;
  module.exports.jsparse = qmlweb_jsparse;
  // Legacy
  module.exports.qmlweb_parse = qmlweb_parse;
  module.exports.qmlweb_jsparse = qmlweb_jsparse;
}
if (typeof window !== 'undefined') {
  // Browser: export only QmlWeb.parse and QmlWeb.jsparse
  if (typeof QmlWeb === 'undefined') {
    window.QmlWeb = {};
  }
  QmlWeb.parse = qmlweb_parse;
  QmlWeb.jsparse = qmlweb_jsparse;
}
