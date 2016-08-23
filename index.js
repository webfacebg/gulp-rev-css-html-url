var through = require('through2');
var crypto = require('crypto');
var gutil = require('gulp-util');
var path = require('path');

module.exports = function override() {
    var allowedPathRegExp = /\.(css|js|html)$/;

    function md5(str) {
        return crypto.createHash('md5').update(str, 'utf8').digest('hex');
    }

    function relPath(base, filePath) {
        if (filePath.indexOf(base) !== 0) {
            return filePath;
        }
        var newPath = filePath.substr(base.length);
        if (newPath[0] === path.sep) {
            return newPath.substr(1);
        } else {
            return newPath;
        }
    }

    var f = [];

    return through.obj(function (file, enc, cb) {
        var firstFile = null;
        if (file.path && file.revOrigPath) {
            firstFile = firstFile || file;

            f.push({
                origPath: relPath(path.resolve(firstFile.revOrigBase), file.revOrigPath),
                hashedPath: relPath(path.resolve(firstFile.base), file.path),
                file: file
            });
        }
        cb();
    }, function (cb) {
        var self = this;

        // sort by filename length to not replace the common part(s) of several filenames
        var longestFirst = f.slice().sort(function (a, b) {
            if(a.origPath.length > b.origPath.length) return -1;
            if(a.origPath.length < b.origPath.length) return 1;
            return 0;
        });
	var dependencyMap = {};
	var timesInRecursion = {};
        f.forEach(function (_f) {
            var file = _f.file;
            if ((allowedPathRegExp.test(file.revOrigPath) ) && file.contents) {
                var contents = file.contents.toString();
                f.forEach(function (__f) {
                    var origPath = __f.origPath.replace(new RegExp('\\' + path.sep, 'g'), '/').replace(/\./g, '\\.');
                    var dependencyFound = contents.match(new RegExp(origPath, 'g'));
                    // Build the dependecy map
                    if (dependencyFound) {
			if (!dependencyMap[_f.origPath]) {
			    dependencyMap[_f.origPath] = {};
			}
			dependencyMap[_f.origPath][__f.origPath] = true;
                    }
                });
	    }
        });
        function replaceDependencies (dependent) {
            // Replace dependencies first
            if (dependencyMap[dependent]) {
	        for (var dependency in dependencyMap[dependent]) {
	    	    // Dependent to be recalculated
	    	    if (typeof timesInRecursion[dependency + "==" + dependent] == "undefined") {
	    	        timesInRecursion[dependency + "==" + dependent] = 0;
	    	    }
	    	    // Check if dependecy loop
	    	    if (timesInRecursion[dependency + "==" + dependent] < 100) {
	    	        timesInRecursion[dependency + "==" + dependent] = parseInt(timesInRecursion[dependency + "==" + dependent]) + 1;
                        replaceDependencies(dependency);
	    	    } else {
	    	        console.log("Too deep recursion in dependencies for: [ " + dependency + " ] included in: [ " + dependent + " ]");
	    	        delete(dependencyMap[dependency][dependent]);
	    	    }
                }
            }
            // Now just Replace
	    // First find the file in the array
	    for (var i = 0; i < f.length; i++) {
		// File ref found!
		if (f[i].origPath == dependent) {
		    // Do the MD5 rock.
		    var file = f[i].file;
		    if ((allowedPathRegExp.test(file.revOrigPath) ) && file.contents) {
			var contents = file.contents.toString();

			// First keep the old hash
			var hash = file.revHash;
			var ext = path.extname(file.path);
			var filename = path.basename(file.revOrigPath, ext) + '-' + file.revHash + ext;

			longestFirst.forEach(function (_f) {
                            if (dependencyMap[f[i].origPath] && dependencyMap[f[i].origPath][_f.origPath]) {
			        var origPath = _f.origPath.replace(new RegExp('\\' + path.sep, 'g'), '/').replace(/\./g, '\\.');
			        var hashedPath = _f.hashedPath.replace(new RegExp('\\' + path.sep, 'g'), '/');
			        var ext = path.extname(_f.origPath);
			         contents = contents.replace(new RegExp(origPath, 'g'), hashedPath);
                            }
			});

			file.path = path.join(path.dirname(file.path), filename);
			// update file's hash as it does in gulp-rev plugin
			file.contents = new Buffer(contents);
			// Calculate the new one after the replace
			file.revHash = md5(contents).slice(0, 10);
			f[i].hashedPath = f[i].hashedPath.replace(hash, file.revHash); // replace the hash in the rev-manifest.json

		    }
		    // If found, no need to continue the loop.
		    break;
		}
	    };
        };
	// fix hashes
	for (var dependent in dependencyMap) {
	    replaceDependencies(dependent);
	}

	// Push to outout
        f.forEach(function (_f) {
            var file = _f.file;
            self.push(file);
        });
        cb();
    });
};
