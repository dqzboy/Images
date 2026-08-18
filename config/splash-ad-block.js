/**
 * Surge splash-ad response cleaner.
 *
 * The script is intentionally conservative. It only rewrites JSON responses
 * selected by the module's URL pattern and fails open on every error.
 *
 * Arguments:
 *   mode=block|audit       audit only reports possible rewrites
 *   level=safe|aggressive aggressive lowers the ad-object score threshold
 *   debug=true|false       print detailed rewrite information
 */

(function () {
  "use strict";

  var SCRIPT_NAME = "SplashAdBlock";
  var REMOVED = { __splashAdBlockRemoved: true };

  var AD_CONTAINER_KEYS = {
    ad: true,
    ads: true,
    adlist: true,
    advert: true,
    adverts: true,
    advertisement: true,
    advertisements: true,
    splash: true,
    splashad: true,
    splashads: true,
    splashlist: true,
    startupad: true,
    startupads: true,
    launchad: true,
    launchads: true,
    bootad: true,
    bootads: true,
    openingad: true,
    openingscreenad: true,
    openscreenad: true,
    welcomead: true,
    welcomeads: true
  };

  var AD_ID_KEYS = {
    adid: true,
    advertid: true,
    advertisementid: true,
    creativeid: true,
    materialid: true,
    campaignid: true,
    placementid: true,
    slotid: true
  };

  var AD_ACTION_KEYS = {
    clickurl: true,
    clicktrackurl: true,
    deeplink: true,
    landingpage: true,
    landingurl: true,
    downloadurl: true,
    impressionurl: true,
    monitorurl: true,
    trackurl: true
  };

  var AD_ASSET_KEYS = {
    adimage: true,
    adimageurl: true,
    coverurl: true,
    imageurl: true,
    materialurl: true,
    resourceurl: true,
    videourl: true
  };

  var AD_BOOLEAN_KEYS = {
    enablead: true,
    enablesplash: true,
    hasad: true,
    isad: true,
    showad: true,
    showsplash: true
  };

  var AD_TIMER_KEYS = {
    adcountdown: true,
    adcountdowntime: true,
    adduration: true,
    delaytime: true,
    displayduration: true,
    showtime: true,
    skiptime: true,
    splashtime: true,
    waittime: true
  };

  function normalizeKey(key) {
    return String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function parseArguments(raw) {
    var result = {};
    String(raw || "")
      .split("&")
      .forEach(function (part) {
        if (!part) return;
        var index = part.indexOf("=");
        var key = index === -1 ? part : part.slice(0, index);
        var value = index === -1 ? "" : part.slice(index + 1);
        try {
          result[decodeURIComponent(key)] = decodeURIComponent(value);
        } catch (_) {
          result[key] = value;
        }
      });
    return result;
  }

  function headerValue(headers, wantedName) {
    var wanted = String(wantedName).toLowerCase();
    var source = headers || {};
    var keys = Object.keys(source);
    for (var i = 0; i < keys.length; i += 1) {
      if (keys[i].toLowerCase() === wanted) return String(source[keys[i]] || "");
    }
    return "";
  }

  function isJsonLike(body, headers) {
    var contentType = headerValue(headers, "content-type").toLowerCase();
    if (contentType.indexOf("json") !== -1 || contentType.indexOf("javascript") !== -1) {
      return true;
    }
    var trimmed = String(body || "").trim();
    return trimmed.charAt(0) === "{" || trimmed.charAt(0) === "[";
  }

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function isAdEndpoint(url) {
    return /(?:^|[\/_?&.=\-])(splash|startup|launch|open.?screen|opening|boot|welcome|advert(?:isement)?|ads?)(?:$|[\/_?&.=\-])/i.test(
      String(url || "")
    );
  }

  function collectKeySignals(object) {
    var signals = {
      ids: 0,
      actions: 0,
      assets: 0,
      booleans: 0,
      explicitAd: false
    };

    Object.keys(object).forEach(function (key) {
      var normalized = normalizeKey(key);
      if (AD_ID_KEYS[normalized]) signals.ids += 1;
      if (AD_ACTION_KEYS[normalized]) signals.actions += 1;
      if (AD_ASSET_KEYS[normalized]) signals.assets += 1;
      if (AD_BOOLEAN_KEYS[normalized]) {
        signals.booleans += 1;
        if (object[key] === true || object[key] === 1 || object[key] === "1") {
          signals.explicitAd = true;
        }
      }
    });

    return signals;
  }

  function adObjectScore(object, parentKey, endpointHint) {
    var parent = normalizeKey(parentKey);
    var signals = collectKeySignals(object);
    var score = 0;

    if (AD_CONTAINER_KEYS[parent]) score += 4;
    if (signals.explicitAd) score += 4;
    if (signals.ids > 0) score += 2;
    if (signals.actions > 0) score += 2;
    if (signals.assets > 0) score += 1;
    if (signals.booleans > 0) score += 1;
    if (endpointHint) score += 1;

    return score;
  }

  function neutralValue(value) {
    if (Array.isArray(value)) return [];
    if (isObject(value)) return {};
    if (typeof value === "boolean") return false;
    if (typeof value === "number") return 0;
    if (typeof value === "string") return "";
    return null;
  }

  function sanitize(value, context, path, isRoot) {
    if (Array.isArray(value)) {
      var output = [];
      for (var i = 0; i < value.length; i += 1) {
        var itemPath = path + "[" + i + "]";
        var item = sanitize(value[i], context, itemPath, false);
        if (item === REMOVED) {
          context.stats.removed += 1;
          context.stats.paths.push(itemPath);
        } else {
          output.push(item);
        }
      }
      return output;
    }

    if (!isObject(value)) return value;

    var score = adObjectScore(value, context.parentKey, context.endpointHint);
    var threshold = context.level === "aggressive" ? 3 : 5;
    if (!isRoot && score >= threshold) {
      return REMOVED;
    }

    var outputObject = {};
    var inheritedAdContext = context.adContext || score >= 3 || AD_CONTAINER_KEYS[normalizeKey(context.parentKey)];

    Object.keys(value).forEach(function (key) {
      var child = value[key];
      var normalized = normalizeKey(key);
      var childPath = path ? path + "." + key : key;

      if (AD_CONTAINER_KEYS[normalized]) {
        outputObject[key] = neutralValue(child);
        context.stats.neutralized += 1;
        context.stats.paths.push(childPath);
        return;
      }

      if (AD_BOOLEAN_KEYS[normalized] && (inheritedAdContext || context.endpointHint)) {
        outputObject[key] = false;
        if (child !== false) {
          context.stats.neutralized += 1;
          context.stats.paths.push(childPath);
        }
        return;
      }

      if (AD_TIMER_KEYS[normalized] && inheritedAdContext) {
        outputObject[key] = 0;
        if (child !== 0) {
          context.stats.neutralized += 1;
          context.stats.paths.push(childPath);
        }
        return;
      }

      var nextContext = {
        adContext: inheritedAdContext || !!AD_CONTAINER_KEYS[normalized],
        endpointHint: context.endpointHint,
        level: context.level,
        parentKey: key,
        stats: context.stats
      };
      var sanitizedChild = sanitize(child, nextContext, childPath, false);
      if (sanitizedChild === REMOVED) {
        outputObject[key] = neutralValue(child);
        context.stats.removed += 1;
        context.stats.paths.push(childPath);
      } else {
        outputObject[key] = sanitizedChild;
      }
    });

    return outputObject;
  }

  function log(message) {
    console.log("[" + SCRIPT_NAME + "] " + message);
  }

  function finish(payload) {
    $done(payload || {});
  }

  try {
    var args = parseArguments(typeof $argument === "undefined" ? "" : $argument);
    var mode = String(args.mode || "block").toLowerCase();
    var level = String(args.level || "safe").toLowerCase();
    var debug = String(args.debug || "false").toLowerCase() === "true";
    var body = $response && typeof $response.body === "string" ? $response.body : "";
    var url = $request && $request.url ? $request.url : "";

    if (!body || !isJsonLike(body, $response.headers)) {
      if (debug) log("Skipped non-JSON or empty response: " + url);
      finish({});
      return;
    }

    var parsed = JSON.parse(body);
    var stats = { removed: 0, neutralized: 0, paths: [] };
    var context = {
      adContext: false,
      endpointHint: isAdEndpoint(url),
      level: level === "aggressive" ? "aggressive" : "safe",
      parentKey: "",
      stats: stats
    };
    var sanitized = sanitize(parsed, context, "$", true);
    var changes = stats.removed + stats.neutralized;

    if (changes === 0) {
      if (debug) log("No high-confidence ad fields found: " + url);
      finish({});
      return;
    }

    var summary =
      "Matched " + changes + " field(s) at " + url +
      (debug ? " -> " + stats.paths.slice(0, 20).join(", ") : "");

    if (mode === "audit") {
      log("AUDIT " + summary);
      finish({});
      return;
    }

    log("BLOCK " + summary);
    finish({ body: JSON.stringify(sanitized) });
  } catch (error) {
    log("Fail-open: " + String(error && error.message ? error.message : error));
    finish({});
  }
})();
