'use strict';

angular.module('DashSourcesService', ['ngResource']).
    factory('Sources', function($resource){
        return $resource('app/sources.json', {}, {
            query: {method:'GET', isArray:false}
        });
    });

angular.module('DashNotesService', ['ngResource']).
    factory('Notes', function($resource){
        return $resource('app/notes.json', {}, {
            query: {method:'GET', isArray:false}
        });
    });

angular.module('DashContributorsService', ['ngResource']).
    factory('Contributors', function($resource){
        return $resource('app/contributors.json', {}, {
            query: {method:'GET', isArray:false}
        });
    });

angular.module('DashPlayerLibrariesService', ['ngResource']).
    factory('PlayerLibraries', function($resource){
        return $resource('app/player_libraries.json', {}, {
            query: {method:'GET', isArray:false}
        });
    });

angular.module('DashShowcaseLibrariesService', ['ngResource']).
    factory('ShowcaseLibraries', function($resource){
        return $resource('app/showcase_libraries.json', {}, {
            query: {method:'GET', isArray:false}
        });
    });

var app = angular.module('DashPlayer', [
    'DashSourcesService',
    'DashNotesService',
    'DashContributorsService',
    'DashPlayerLibrariesService',
    'DashShowcaseLibrariesService',
    'angularTreeview'
]);

app.directive('chart', function() {
    return {
        restrict: 'E',
        link: function (scope, elem, attrs) {
            var chart = null,
                options = {
                    series: {
                        shadowSize: 0
                    },
                    yaxis: {
                        min: 0,
                        max: 5.1
                    },
                    xaxis: {
                        show: false
                    }
                };
                /*options2 = {
                    series: {
                        shadowSize: 0
                    },
                    yaxis: {
                        min: 0,
                        max: 5.1
                    },
                    xaxis: {
                        show: false
                    }
                }*/

            // If the data changes somehow, update it in the chart
            /*scope.$watch('bufferData', function(v) {
                if (v === null || v === undefined) {
                    return;
                }

                if (!chart) {
                    chart = $.plot(elem, v , options);
                    elem.show();
                }
                else {
                    chart.setData(v);
                    chart.setupGrid();
                    chart.draw();
                }
            });*/

            // If the data changes somehow, update it in the chart
            scope.$watch('QoEData', function(v) {
                if (v === null || v === undefined) {
                    return;
                }

                if (!chart) {
                    chart = $.plot(elem, v , options);
                    elem.show();
                }
                else {
                    chart.setData(v);
                    chart.setupGrid();
                    chart.draw();
                }
            });

            scope.$watch('invalidateChartDisplay', function(v) {
                if (v && chart) {
                    var data = scope[attrs.ngModel];
                    chart.setData(data);
                    chart.setupGrid();
                    chart.draw();
                    scope.invalidateDisplay(false);
                }
            });
        }
    };
});

app.controller('DashController', function($scope, Sources, Notes, Contributors, PlayerLibraries, ShowcaseLibraries) {
    var player,
        controlbar,
        video,
        ttmlDiv,
        context,
        videoSeries = [],
        audioSeries = [],
        qoeSeries = [],
        maxGraphPoints = 100;

    ////////////////////////////////////////
    //
    // Metrics
    //
    ////////////////////////////////////////

    $scope.videoBitrate = 0;
    $scope.videoIndex = 0;
    $scope.videoPendingIndex = "";
    $scope.videoMaxIndex = 0;
    $scope.videoBufferLength = 0;
    $scope.videoDroppedFrames = 0;
    $scope.videoLatencyCount = 0;
    $scope.videoLatency = "";
    $scope.videoDownloadCount = 0;
    $scope.videoDownload = "";
    $scope.videoRatioCount = 0;
    $scope.videoRatio = "";
    // Added by chenw-2015-1115
    $scope.videoBufferState = "bufferStalled";
    $scope.videoFreezingTime = 0;
    $scope.videoMaxBitrate = 0;
    $scope.totalFreezingPeriod = 0;
    $scope.videoQoE = 5;

    $scope.audioBitrate = 0;
    $scope.audioIndex = 0;
    $scope.audioPendingIndex = "";
    $scope.audioMaxIndex = 0;
    $scope.audioBufferLength = 0;
    $scope.audioDroppedFrames = 0;
    $scope.videoLatencyCount = 0;
    $scope.audioLatency = "";
    $scope.audioDownloadCount = 0;
    $scope.audioDownload = "";
    $scope.audioRatioCount = 0;
    $scope.audioRatio = "";


    var converter = new MetricsTreeConverter();
    $scope.videoMetrics = null;
    $scope.audioMetrics = null;
    $scope.streamMetrics = null;

    $scope.getVideoTreeMetrics = function () {
        var metrics = player.getMetricsFor("video");
        $scope.videoMetrics = converter.toTreeViewDataSource(metrics);
    }

    $scope.getAudioTreeMetrics = function () {
        var metrics = player.getMetricsFor("audio");
        $scope.audioMetrics = converter.toTreeViewDataSource(metrics);
    }

    $scope.getStreamTreeMetrics = function () {
        var metrics = player.getMetricsFor("stream");
        $scope.streamMetrics = converter.toTreeViewDataSource(metrics);
    }

    // from: https://gist.github.com/siongui/4969449
    $scope.safeApply = function(fn) {
      var phase = this.$root.$$phase;
      if(phase == '$apply' || phase == '$digest')
        this.$eval(fn);
      else
        this.$apply(fn);
    };

    function getCribbedMetricsFor(type) {
        var metrics = player.getMetricsFor(type),
            metricsExt = player.getMetricsExt(),
            repSwitch,
            bufferLevel,
            httpRequests,
            droppedFramesMetrics,
            bitrateIndexValue,
            bandwidthValue,
            pendingValue,
            numBitratesValue,
            bufferLengthValue = 0,
            point,
            movingLatency = {},
            movingDownload = {},
            movingRatio = {},
            droppedFramesValue = 0,
            // chenw-2015-1114
            bufferState,
            stallingPeriod = 0,
            totalStallingPeriod = 0,
            vidMaxBitrate = 0, 
            requestsQueue,
            fillmoving = function(type, Requests){
                var requestWindow,
                    downloadTimes,
                    latencyTimes,
                    durationTimes;

                requestWindow = Requests
                    .slice(-20)
                    .filter(function(req){return req.responsecode >= 200 && req.responsecode < 300 && !!req.mediaduration && req.type === "Media Segment" && req.stream === type;})
                    .slice(-4);
                if (requestWindow.length > 0) {

                    latencyTimes = requestWindow.map(function (req){ return Math.abs(req.tresponse.getTime() - req.trequest.getTime()) / 1000;});

                    movingLatency[type] = {
                        average: latencyTimes.reduce(function(l, r) {return l + r;}) / latencyTimes.length, 
                        high: latencyTimes.reduce(function(l, r) {return l < r ? r : l;}), 
                        low: latencyTimes.reduce(function(l, r) {return l < r ? l : r;}), 
                        count: latencyTimes.length
                    };

                    downloadTimes = requestWindow.map(function (req){ return Math.abs(req.tfinish.getTime() - req.tresponse.getTime()) / 1000;});

                    movingDownload[type] = {
                        average: downloadTimes.reduce(function(l, r) {return l + r;}) / downloadTimes.length, 
                        high: downloadTimes.reduce(function(l, r) {return l < r ? r : l;}), 
                        low: downloadTimes.reduce(function(l, r) {return l < r ? l : r;}), 
                        count: downloadTimes.length
                    };

                    durationTimes = requestWindow.map(function (req){ return req.mediaduration;});

                    movingRatio[type] = {
                        average: (durationTimes.reduce(function(l, r) {return l + r;}) / downloadTimes.length) / movingDownload[type].average, 
                        high: durationTimes.reduce(function(l, r) {return l < r ? r : l;}) / movingDownload[type].low, 
                        low: durationTimes.reduce(function(l, r) {return l < r ? l : r;}) / movingDownload[type].high, 
                        count: durationTimes.length
                    };
                }
            };

        if (metrics && metricsExt) {
            repSwitch = metricsExt.getCurrentRepresentationSwitch(metrics);
            bufferLevel = metricsExt.getCurrentBufferLevel(metrics);
            httpRequests = metricsExt.getHttpRequests(metrics);
            droppedFramesMetrics = metricsExt.getCurrentDroppedFrames(metrics);
            requestsQueue = metricsExt.getRequestsQueue(metrics);
            // chenw-2015-1114
            bufferState = metricsExt.getCurrentBufferState(metrics);
            stallingPeriod = metricsExt.getCurrentStalling(metrics);
            totalStallingPeriod = metricsExt.getTotalStalling(metrics);

            fillmoving("video", httpRequests);
            fillmoving("audio", httpRequests);

            var streamIdx = $scope.streamInfo.index;

            if (repSwitch !== null) {
                bitrateIndexValue = metricsExt.getIndexForRepresentation(repSwitch.to, streamIdx);
                // console.log("Representation ID: " + repSwitch.to + " at bitrate level index: " + bitrateIndexValue);
                bandwidthValue = metricsExt.getBandwidthForRepresentation(repSwitch.to, streamIdx);
                bandwidthValue = bandwidthValue / 1000;
                bandwidthValue = Math.round(bandwidthValue);
            }

            // Added by chenw-2015-1115
            vidMaxBitrate = metricsExt.getMaxAllowedBitrateForBufferType(type, streamIdx) / 1000;
            numBitratesValue = metricsExt.getMaxIndexForBufferType(type, streamIdx);

            if (bufferLevel !== null) {
                bufferLengthValue = bufferLevel.level.toPrecision(5);
            }

            // Added by chenw-2015-1115
            /*
            if (bufferState !== null) 
            {
                // console.log(bufferLevel);
                // console.log(bufferState);
                bufferStateValue = bufferState.state;
            }*/

            if (droppedFramesMetrics !== null) {
                droppedFramesValue = droppedFramesMetrics.droppedFrames;
            }

            if (isNaN(bandwidthValue) || bandwidthValue === undefined) {
                bandwidthValue = 0;
            }

            if (isNaN(bitrateIndexValue) || bitrateIndexValue === undefined) {
                bitrateIndexValue = 0;
            }

            if (isNaN(numBitratesValue) || numBitratesValue === undefined) {
                numBitratesValue = 0;
            }

            if (isNaN(bufferLengthValue) || bufferLengthValue === undefined) {
                bufferLengthValue = 0;
            }

            pendingValue = player.getQualityFor(type);

            return {
                bandwidthValue: bandwidthValue,
                bitrateIndexValue: bitrateIndexValue + 1,
                pendingIndex: (pendingValue !== bitrateIndexValue) ? "(-> " + (pendingValue + 1) + ")" : "",
                numBitratesValue: numBitratesValue,
                bufferLengthValue: bufferLengthValue,
                droppedFramesValue: droppedFramesValue,
                movingLatency: movingLatency,
                movingDownload: movingDownload,
                movingRatio: movingRatio,
                requestsQueue: requestsQueue,
                // return bufferStateValue, chenw-2015-1114
                bufferState: bufferState,
                stallingPeriod: stallingPeriod,
                totalStallingPeriod:totalStallingPeriod,
                vidMaxBitrate:vidMaxBitrate
            }
        }
        else {
            return null;
        }
    }

    function processManifestUpdateMetrics(metrics) {
        var data = $scope.manifestUpdateInfo || [],
            manifestInfo = metrics.ManifestUpdate,
            propsWithDelta = ["requestTime", "fetchTime", "availabilityStartTime", "presentationStartTime", "clientTimeOffset", "currentTime", "latency"],
            ln = manifestInfo.length,
            hasValue,
            info,
            prop,
            value,
            item,
            delta,
            k,
            ranges,
            range,
            rangeLn,
            prevInfo,
            stream,
            track,
            prevStream,
            prevTrack,
            isUpdate = (data.length === ln),
            i = Math.max(ln - 1, 0);

        if (ln === 0) return null;

        for (i; i < ln; i += 1) {
            info = manifestInfo[i];
            item = {};

            for (prop in info) {
                prevInfo = data[i - 1];

                if (isUpdate) {
                    item = data[i];
                }

                value = info[prop];
                hasValue = (value !== null) && (value !== undefined);

                if (typeof value === "number") {
                    value = value.toFixed(2);
                }

                item[prop] = hasValue ? value : " - ";

                if (propsWithDelta.indexOf(prop) === -1 || !hasValue || !prevInfo) continue;

                delta = value - prevInfo[prop];

                if (value instanceof(Date)) {
                    delta /= 1000;
                }

                item[prop + "Delta"] = "(" + delta.toFixed(2) + ")";
            }

            ranges = item.buffered;

            if (ranges && ranges.length > 0) {
                rangeLn = ranges.length;
                item.buffered = [];
                for (k = 0; k < rangeLn; k += 1) {
                    range = {};
                    range.start = ranges.start(k).toFixed(2);
                    range.end = ranges.end(k).toFixed(2);
                    range.size = (range.end - range.start).toFixed(2);
                    item.buffered.push(range);
                }
            } else {
                item.buffered = [{start: "-", end: "-", size: "-"}];
            }

            for (k = 0; k < info.streamInfo.length; k += 1) {
                stream = item.streamInfo[k];

                if (!prevInfo) break;

                prevStream = prevInfo.streamInfo[k];

                if (!prevStream) continue;

                stream.startDelta = "(" + (stream.start - prevStream.start).toFixed(2) + ")";
                stream.durationDelta = "(" + (stream.duration - prevStream.duration).toFixed(2) + ")";
            }

            for (k = 0; k < info.trackInfo.length; k += 1) {
                track = item.trackInfo[k];

                if (!prevInfo) break;

                prevTrack = prevInfo.trackInfo[k];

                if (!prevTrack) continue;

                track.startNumberDelta = "(" + (track.startNumber - prevTrack.startNumber) + ")";
                track.presentationTimeOffsetDelta = "(" + (track.presentationTimeOffset - prevTrack.presentationTimeOffset).toFixed(2) + ")";
            }

            if (isUpdate) continue;

            data.push(item);
        }

        return data;
    }

    // added by chenw-2015-1115, computing real-time video QoE based on current chunk bitrate and 
    // current freezing time.
    function computeQoE(currentBitrate, maxBitrate, currentFreezingTime) {
        var a0 = 1.3554, a1 = 40.0, 
        b0 = 5.0, b1 = 6.3484, b2 = 4.4, b3 = 0.72134, 
        q0 = 5.0, 
        q1 = 5.0,
        base, 
        qoe,
        delta = 0.2;

        if (currentFreezingTime > 0) {
            base = Math.log(b2/currentFreezingTime);
            q0 = b0 - b1 / (1 + Math.exp(base * b3));
        }

        q1 = a0 * Math.log(a1 * currentBitrate/maxBitrate);

        qoe = delta * q0 + (1 - delta) * q1;

        return qoe;
    }

    function metricChanged(e) {
        var metrics,
            point,
            qoePoint,
            treeData,
            bufferedRanges = [];

        // get current buffered ranges of video element and keep them up to date
        for (var i = 0; i < video.buffered.length; i += 1) {
            bufferedRanges.push(video.buffered.start(i) + ' - ' + video.buffered.end(i));
        }
        $scope.bufferedRanges = bufferedRanges;

        if (e.data.stream == "video") {
            metrics = getCribbedMetricsFor("video");
            if (metrics) {
                $scope.videoBitrate = metrics.bandwidthValue;
                $scope.videoIndex = metrics.bitrateIndexValue;
                $scope.videoPendingIndex = metrics.pendingIndex;
                $scope.videoMaxIndex = metrics.numBitratesValue;
                $scope.videoBufferLength = metrics.bufferLengthValue;
                $scope.videoDroppedFrames = metrics.droppedFramesValue;
                $scope.videoRequestsQueue = metrics.requestsQueue;
                // Added bufferStateValue, etc. to the $scope to show in real-time, added by chenw-2015-1115
                $scope.videoBufferState = metrics.bufferState;
                $scope.videoFreezingTime = metrics.stallingPeriod;
                $scope.totalFreezingPeriod = metrics.totalStallingPeriod;
                $scope.videoMaxBitrate = metrics.vidMaxBitrate;
                $scope.videoQoE = computeQoE($scope.videoBitrate, $scope.videoMaxBitrate, $scope.videoFreezingTime);
                if (metrics.movingLatency["video"]) {
                    $scope.videoLatencyCount = metrics.movingLatency["video"].count;
                    $scope.videoLatency = metrics.movingLatency["video"].low.toFixed(3) + " < " + metrics.movingLatency["video"].average.toFixed(3) + " < " + metrics.movingLatency["video"].high.toFixed(3);
                }
                if (metrics.movingDownload["video"]) {
                    $scope.videoDownloadCount = metrics.movingDownload["video"].count;
                    $scope.videoDownload = metrics.movingDownload["video"].low.toFixed(3) + " < " + metrics.movingDownload["video"].average.toFixed(3) + " < " + metrics.movingDownload["video"].high.toFixed(3);
                }
                if (metrics.movingRatio["video"]) {
                    $scope.videoRatioCount = metrics.movingRatio["video"].count;
                    $scope.videoRatio = metrics.movingRatio["video"].low.toFixed(3) + " < " + metrics.movingRatio["video"].average.toFixed(3) + " < " + metrics.movingRatio["video"].high.toFixed(3);
                }

                point = [parseFloat(video.currentTime), Math.round(parseFloat(metrics.bufferLengthValue))];
                videoSeries.push(point);

                qoePoint = [parseFloat(video.currentTime), parseFloat($scope.videoQoE)];
                qoeSeries.push(qoePoint);
                // console.log("[chenw]" + qoeSeries);

                if (videoSeries.length > maxGraphPoints) {
                    videoSeries.splice(0, 1);
                }

                if (qoeSeries.length > maxGraphPoints) {
                    qoeSeries.splice(0, 1);
                }
            }
        }

        if (e.data.stream == "audio") {
            metrics = getCribbedMetricsFor("audio");
            if (metrics) {
                $scope.audioBitrate = metrics.bandwidthValue;
                $scope.audioIndex = metrics.bitrateIndexValue;
                $scope.audioPendingIndex = metrics.pendingIndex;
                $scope.audioMaxIndex = metrics.numBitratesValue;
                $scope.audioBufferLength = metrics.bufferLengthValue;
                $scope.audioDroppedFrames = metrics.droppedFramesValue;
                $scope.audioRequestsQueue = metrics.requestsQueue;
                if (metrics.movingLatency["audio"]) {
                    $scope.audioLatencyCount = metrics.movingLatency["audio"].count;
                    $scope.audioLatency = metrics.movingLatency["audio"].low.toFixed(3) + " < " + metrics.movingLatency["audio"].average.toFixed(3) + " < " + metrics.movingLatency["audio"].high.toFixed(3);
                }
                if (metrics.movingDownload["audio"]) {
                    $scope.audioDownloadCount = metrics.movingDownload["audio"].count;
                    $scope.audioDownload = metrics.movingDownload["audio"].low.toFixed(3) + " < " + metrics.movingDownload["audio"].average.toFixed(3) + " < " + metrics.movingDownload["audio"].high.toFixed(3);
                }
                if (metrics.movingRatio["audio"]) {
                    $scope.audioRatioCount = metrics.movingRatio["audio"].count;
                    $scope.audioRatio = metrics.movingRatio["audio"].low.toFixed(3) + " < " + metrics.movingRatio["audio"].average.toFixed(3) + " < " + metrics.movingRatio["audio"].high.toFixed(3);
                }

                point = [parseFloat(video.currentTime), Math.round(parseFloat(metrics.bufferLengthValue))];
                audioSeries.push(point);

                if (audioSeries.length > maxGraphPoints) {
                    audioSeries.splice(0, 1);
                }
            }
        }

        $scope.invalidateDisplay(true);
        $scope.safeApply();
    }

    function metricUpdated(e) {
        var metrics = player.getMetricsFor("stream"),
            data;

        if (!e.data.metric || e.data.metric.indexOf("ManifestUpdate") === -1 || !metrics) return;

        data = processManifestUpdateMetrics(metrics);

        if (!data) return;

        $scope.manifestUpdateInfo = data;
        $scope.invalidateDisplay(true);
        $scope.safeApply();
    }

    function streamSwitch(e) {
        $scope.streamInfo = e.data.toStreamInfo;
    }

    function streamInitialized(e) {
        var availableTracks = {};
        availableTracks.audio = player.getTracksFor("audio");
        availableTracks.video = player.getTracksFor("video");
        $scope.availableTracks = availableTracks;
    }

    ////////////////////////////////////////
    //
    // Error Handling
    //
    ////////////////////////////////////////

    function onError(e) {

    }

    ////////////////////////////////////////
    //
    // Debugging
    //
    ////////////////////////////////////////

    $scope.invalidateChartDisplay = false;

    $scope.invalidateDisplay = function (value) {
        $scope.invalidateChartDisplay = value;
    }

    $scope.bufferData = [
        {
            data: videoSeries,
            label: "Video",
            color: "#2980B9"
        },
        {
            data: audioSeries,
            label: "Audio",
            color: "#E74C3C"
        }
    ];

    $scope.QoEData = [
        {
            data: qoeSeries,
            label: "Real-time Video QoE",
            color: "#E74C3C"
        }
    ];

    $scope.showCharts = false;
    $scope.setCharts = function (show) {
        $scope.showCharts = show;
    }

    $scope.setBufferLevelChart = function(show) {
        $scope.showBufferLevel = show;
    }

    $scope.setQoEChart = function(show) {
        $scope.showQoE = show;
    }

    $scope.showDebug = false;
    $scope.setDebug = function (show) {
        $scope.showDebug = show;
    }

    ////////////////////////////////////////
    //
    // Player Setup
    //
    ////////////////////////////////////////

    video = document.querySelector(".dash-video-player video");
    context = new Dash.di.DashContext();
    player = new MediaPlayer(context);

    $scope.version = player.getVersion();

    player.startup();
    player.addEventListener(MediaPlayer.events.ERROR, onError.bind(this));
    player.addEventListener(MediaPlayer.events.METRIC_CHANGED, metricChanged.bind(this));
    player.addEventListener(MediaPlayer.events.METRIC_UPDATED, metricUpdated.bind(this));
    player.addEventListener(MediaPlayer.events.STREAM_SWITCH_COMPLETED, streamSwitch.bind(this));
    player.addEventListener(MediaPlayer.events.STREAM_INITIALIZED, streamInitialized.bind(this));
    player.attachView(video);
    player.attachVideoContainer(document.getElementById("videoContainer"));

    // Add HTML-rendered TTML subtitles
    ttmlDiv = document.querySelector("#video-caption");
    player.attachTTMLRenderingDiv(ttmlDiv);

    player.setAutoPlay(true);
    controlbar = new ControlBar(player);
    controlbar.initialize();
    controlbar.disable() //controlbar.hide() // other option

    ////////////////////////////////////////
    //
    // Player Methods
    //
    ////////////////////////////////////////

    $scope.abrEnabled = true;

    $scope.setAbrEnabled = function (enabled) {
        $scope.abrEnabled = enabled;
        player.setAutoSwitchQuality(enabled);
    }

    $scope.abrUp = function (type) {
        var newQuality,
            metricsExt = player.getMetricsExt(),
            max = metricsExt.getMaxIndexForBufferType(type, $scope.streamInfo.index);

        newQuality = player.getQualityFor(type) + 1;
        // zero based
        if (newQuality >= max) {
            newQuality = max - 1;
        }
        player.setQualityFor(type, newQuality);
    }

    $scope.abrDown = function (type) {
        var newQuality = player.getQualityFor(type) - 1;
        if (newQuality < 0) {
            newQuality = 0;
        }
        player.setQualityFor(type, newQuality);
    }

    ////////////////////////////////////////
    //
    // Page Setup
    //
    ////////////////////////////////////////

    function getUrlVars() {
        var vars = {};
        var parts = window.location.href.replace(/[?&]+([^=&]+)=([^&]*)/gi, function(m,key,value) {
            vars[key] = value;
        });
        return vars;
    }

    // Get url params...
    var vars = getUrlVars();

    Sources.query(function (data) {
        $scope.availableStreams = data.items;
    });

    Notes.query(function (data) {
        $scope.releaseNotes = data.notes;
    });

    Contributors.query(function (data) {
        $scope.contributors = data.items;
    });

    PlayerLibraries.query(function (data) {
        $scope.playerLibraries = data.items;
    });

    ShowcaseLibraries.query(function (data) {
        $scope.showcaseLibraries = data.items;
    });

    $scope.setStream = function (item) {
        $scope.selectedItem = item;
    }

    $scope.doLoad = function () {
        var protData = null,
            initialSettings;
        if ($scope.selectedItem.hasOwnProperty("protData")) {
            protData = $scope.selectedItem.protData;
        }
        player.attachSource($scope.selectedItem.url, null, protData);
        player.setAutoSwitchQuality($scope.abrEnabled);
        controlbar.reset();
        controlbar.enable();

        if ($scope.initialSettings.audio) {
            player.setInitialMediaSettingsFor("audio", {lang: $scope.initialSettings.audio});
        }
        if ($scope.initialSettings.video) {
            player.setInitialMediaSettingsFor("video", {role: $scope.initialSettings.video});
        }

        $scope.manifestUpdateInfo = null;
    }

    $scope.switchTrack = function(track, type) {
        if (!track || (track === player.getCurrentTrackFor(type))) return;

        player.setCurrentTrack(track);
    }

    $scope.changeTrackSwitchMode = function(mode, type) {
        player.setTrackSwitchModeFor(type, mode);
    }

    $scope.initialSettings = {audio: null, video: null};
    $scope.mediaSettingsCacheEnabled = true;

    $scope.setMediaSettingsCacheEnabled = function(enabled) {
        $scope.mediaSettingsCacheEnabled = enabled;
        player.enableLastMediaSettingsCaching(enabled);
    }

    $scope.hasLogo = function (item) {
        return (item.hasOwnProperty("logo")
                && item.logo !== null
                && item.logo !== undefined
                && item.logo !== "");
    }

    // Get initial stream if it was passed in.
	var paramUrl = null;

    if (vars && vars.hasOwnProperty("url")) {
    	paramUrl = vars.url;
    }

    if (vars && vars.hasOwnProperty("mpd")) {
    	paramUrl = vars.mpd;
    }

    if (paramUrl !== null) {
    	var startPlayback = true;
    
    	$scope.selectedItem = {};
        $scope.selectedItem.url = paramUrl;

        if (vars.hasOwnProperty("autoplay")) {
        	startPlayback = (vars.autoplay === 'true');
        }

    	if (startPlayback) {
	    	$scope.doLoad();
		}
    }
});
