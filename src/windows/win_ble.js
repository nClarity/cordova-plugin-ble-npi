var bluetooth = Windows.Devices.Bluetooth;
var deviceInfo = Windows.Devices.Enumeration.DeviceInformation;
var gatt = Windows.Devices.Bluetooth.GenericAttributeProfile;
var DevEnum = Windows.Devices.Enumeration;

var deviceWatcher;

var WATCH_CACHE = {};
var LISTEN_CACHE = {};

var serviceUuidFilter = null;
var successFn;
var failureFn;

var notifyCallback;

var scanTimer;
var connectTimer;

// *** DEVICE ENUMERATION SECTION ***

function initializeDevice( selector, success, failure ) {

    var selector1 = "System.Devices.Aep.ProtocolId:=\"{bb7bb05e-5972-42b5-94fc-76eaa7084d49}\"";

    var kind = Windows.Devices.Enumeration.DeviceInformationKind.associationEndpoint;
    var reqProperties = [];
    reqProperties[0] = "System.Devices.Aep.DeviceAddress";
    reqProperties[1] = "System.Devices.Aep.IsConnected";
    reqProperties[2] = "System.Devices.Aep.SignalStrength";

    deviceInfo.findAllAsync( selector, reqProperties ).then(
        function ( devices ) {
            if ( devices.length > 0 ) {
                isInitialized = true;
                success( devices[0] );
            } else {
                failure( { error: "initialize", message: "No BLE devices found." } );
            }
        },
        function ( error ) {
            failure( { error: "initialize", message: error.message } );
        } );
}

function startWatcher() {
    var DeviceWatcherStatus = Windows.Devices.Enumeration.DeviceWatcherStatus;
    // Get the device selector chosen by the UI then add additional constraints for devices that
    // can be paired or are already paired.
    var selector = "System.Devices.Aep.ProtocolId:=\"{bb7bb05e-5972-42b5-94fc-76eaa7084d49}\""; //BLE

    var kind = Windows.Devices.Enumeration.DeviceInformationKind.associationEndpoint;

    var reqProperties = [];
    reqProperties[0] = "System.Devices.Aep.DeviceAddress";
    reqProperties[1] = "System.Devices.Aep.IsConnected";
    reqProperties[2] = "System.Devices.Aep.SignalStrength";


    if ( !deviceWatcher ) {
        deviceWatcher = DevEnum.DeviceInformation.createWatcher( selector, reqProperties, kind );

        // Add event handlers
        deviceWatcher.addEventListener( "added", onAdded, false );
        deviceWatcher.addEventListener( "updated", onUpdated, false );
        //deviceWatcher.addEventListener( "removed", onRemoved, false );
        deviceWatcher.addEventListener( "enumerationcompleted", onEnumerationCompleted, false );
        deviceWatcher.addEventListener( "stopped", onStopped, false );

        console.log( "Starting watcher..." );
        try {
            deviceWatcher.start();
        } catch ( err ) {
            console.log( "deviceWatcher error: " + err );
        }

    } else {
        if ( deviceWatcher.status !== DeviceWatcherStatus.started &&
            deviceWatcher.status !== DeviceWatcherStatus.created &&
            deviceWatcher.status !== DeviceWatcherStatus.stopped &&
            deviceWatcher.status !== DeviceWatcherStatus.aborted ) {

            console.log( 'Scan already in progress' );
        }
    }
    return;
}

function stopWatcher() {
    var stopsuccess = true;
    
    clearTimeout( scanTimer );

    if ( deviceWatcher !== undefined ) {
        console.log( "Stopping watcher" );
        deviceWatcher.removeEventListener( "added", onAdded );
        deviceWatcher.removeEventListener( "updated", onUpdated );
        deviceWatcher.removeEventListener( "removed", onRemoved );
        deviceWatcher.removeEventListener( "enumerationcompleted", onEnumerationCompleted );
        deviceWatcher.removeEventListener( "stopped", onStopped );

        if ( DevEnum.DeviceWatcherStatus.started === deviceWatcher.status ||
            DevEnum.DeviceWatcherStatus.enumerationCompleted === deviceWatcher.status ) {
            deviceWatcher.stop();
            deviceWatcher = undefined;
            console.log( "Watcher stopped..." );
        }

    } else {
        stopsuccess = false;
    }

    return stopsuccess;
}

function onAdded( devinfo ) {

    var thisDevice = {
        advertising: {
            services: []
        },
        id: devinfo.id,
        name: devinfo.name,
        rssi: 0
    };
    var rssi = 0;

    if ( !devinfo.name ) {
        thisDevice.name = "Unknown";
    }

    //Initialize our BLE object
    function init() {
        if ( !WATCH_CACHE[devinfo.id] ) {
            WATCH_CACHE[devinfo.id] = {};
            WATCH_CACHE[devinfo.id].deviceInfo = thisDevice;
            WATCH_CACHE[devinfo.id].device = devinfo;
            WATCH_CACHE[devinfo.id].ble = {
                ble: {},
                listener: {},
                success: {},
                failure: {}
            };
            WATCH_CACHE[devinfo.id].services = {}; //.characteristics = {}; .descriptors
            console.log( "Enumeration found: " + devinfo.name + "  >>>  " + devinfo.id );
        }
    }

    function searchForUuid() {

        function checkUuid( bleDevice ) {

            bleDevice.getGattServicesForUuidAsync( serviceUuidFilter ).done(
                function ( result ) {
                    if ( result.status === gatt.GattCommunicationStatus.success ) {
                        var services = result.services;
                        if ( result.services.length > 0 ) {
                            WATCH_CACHE[devinfo.id].ble.ble = bleDevice;
                            if ( devinfo.name === "Unknown" ) {
                                WATCH_CACHE[devinfo.id].deviceInfo.name = bleDevice.name;
                            }
                            console.log( "Searching ServiceUuid: {" + services[0].uuid + "} - found a matching device: " + bleDevice.name + " ID: " + bleDevice.id );
                            if ( scanTimer ) { clearTimeout( scanTimer ); }
                            returnDevice();
                        } else {
                            bleDevice.close();
                            console.log( "Device: " + bleDevice.name + " is not a match" );
                        }
                    }
                },
                function ( error ) {
                    console.log( "Failure getting GATT for: " + bleDevice.name );
                }
            );
        }

        getBLE( devinfo.id, checkUuid, returnDevice );
    }

    function returnDevice() {

        if ( devinfo.properties['System.Devices.Aep.SignalStrength'] !== null ) {
            WATCH_CACHE[devinfo.id].rssi = devinfo.properties['System.Devices.Aep.SignalStrength'];
        }

        successFn( WATCH_CACHE[devinfo.id].deviceInfo, { keepCallback: true } );
    }

    init();

    if ( serviceUuidFilter !== null ) {
        searchForUuid();
    } else {
        returnDevice();
    }

}

function onUpdated( devUpdate ) {
    // Find the corresponding updated DeviceInformation in the collection and pass the update object
    // to the Update method of the existing DeviceInformation. This automatically updates the object
    // for us.
    if ( WATCH_CACHE[devUpdate.id] ) {
        WATCH_CACHE[devUpdate.id].device.update( devUpdate );
    }
}

function onRemoved( devUpdate ) {
    console.log( "onRemoved: device:" + devUpdate.id );
    //delete WATCH_CACHE[devUpdate.id];
}

function onEnumerationCompleted( obj ) {
    console.log( Object.keys( WATCH_CACHE ).length + " devices found. Enumeration completed. Watching for updates..." );
}

function onStopped( obj ) {
    var msg = '';
    if ( deviceWatcher.status === Windows.Devices.Enumeration.DeviceWatcherStatus.aborted ) {
        msg = 'Enumeration stopped unexpectedly.';
    } else if ( deviceWatcher.status === Windows.Devices.Enumeration.DeviceWatcherStatus.stopped ) {
        msg = 'You requested to stop enumeration';
    }
    console.log( 'onStopped message: ' + msg );
    console.log( Object.keys( WATCH_CACHE ).length + " devices found. Watcher stopped" );
}

//**GATT Functions

function getDeviceSelectorFromUuid( serviceUuidFilter ) {
    //Creates a suitable AQS Filter string for use with the CreateWatcher method, from a Bluetooth service UUID.
    var string = gatt.GattDeviceService.getDeviceSelectorFromUuid( serviceUuidFilter );
    return string;
}

function getSelector( serviceUuidFilter ) {
    //Creates the AQS filter for deviceWatcher
    var selector = "System.Devices.Aep.ProtocolId:=\"{bb7bb05e-5972-42b5-94fc-76eaa7084d49}\""; //BLE
    //var selector = "System.Devices.Aep.ProtocolId:=\"{e0cbf06c-cd8b-4647-bb8a-263b43f0f974}\""; //Bluetooth

    if ( serviceUuidFilter && serviceUuidFilter !== null ) {
        selector = getDeviceSelectorFromUuid( serviceUuidFilter );
    }

    return selector;
}

function pairDevice( deviceID, success, failure ) {
    var DPPL = Windows.Devices.Enumeration.DevicePairingProtectionLevel;

    if ( WATCH_CACHE[deviceID].ble.deviceInformation.pairing.isPaired === true ) {
        console.log( "Already paired with " + WATCH_CACHE[deviceID].device.name );
        success( deviceID );
    } else if ( WATCH_CACHE[deviceID].ble.deviceInformation.pairing.canPair === true ) {
        var pMsg = "Not properly paired";
        WATCH_CACHE[deviceID].ble.deviceInformation.pairing.pairAsync( DPPL.none ).done(
            function ( pairingResult ) {
                if ( connectTimer ) { clearTimeout( connectTimer ); }
                pMsg = returnEnum( pairingResult.status, DevEnum.DevicePairingResultStatus );
                console.log( "Pairing result with " + WATCH_CACHE[deviceID].device.name + " = " + pMsg );
                if ( pairingResult.status === DevEnum.DevicePairingResultStatus.paired ) {
                    success( deviceID );
                } else if ( pairingResult.status === 19 ) {
                    failure( pMsg );
                }
                return;
            } );
    } else { //not able to pair
        console.log( "Not able to pair with this device: " + deviceSelected.name );
        getGATT();
    }
}

function setBLEStatusListener( bleDevice, success, failure ) {
    var result = {
        id: bleDevice.ble.deviceId,
        status: returnEnum( bleDevice.ble.connectionStatus, bluetooth.BluetoothConnectionStatus )
    };

    bleDevice.listener = function ( e ) {
        if ( e.target.connectionStatus === bluetooth.BluetoothConnectionStatus.disconnected ) {
            result.status = "disconnected";
            if ( bleDevice.ble ) {
                bleDevice.ble.removeEventListener( 'connectionstatuschanged', bleDevice.listener );
                failure( result );
            }
        }
    };

    // Attach listener to device to report disconnected event
    bleDevice.ble.addEventListener( 'connectionstatuschanged', bleDevice.listener, false );

    success( result, { keepCallback: true } );
}

function getBLE( deviceID, success, failure ) {
    bluetooth.BluetoothLEDevice.fromIdAsync( deviceID ).done(
        function ( bleDevice ) {
            //console.log( "BluetoothLeDevice object created" );
            success( bleDevice );
        },
        function ( error ) {
            failure( error );
        }
    );
}

function getGATTServices( bleDevice, cacheMode, success, failure ) {
    //Returns a list of Service Uuid's
    //cacheMode = bluetooth.BluetoothCacheMode.uncached || bluetooth.BluetoothCacheMode.cached

    bleDevice.getGattServicesAsync( cacheMode ).done(
        function ( result ) {
            if ( result.status === gatt.GattCommunicationStatus.success ) {
                var services = result.services;
                var len = services.length;
                var serviceObj = {};
                console.log( "GattServices - found: " + len + " services" );
                for ( var i = 0; i < len; i++ ) {
                    serviceObj[services[i].uuid] = {};
                    serviceObj[services[i].uuid].uuid = services[i].uuid;
                    serviceObj[services[i].uuid].service = services[i];
                    console.log( "Service: " + services[i].uuid );
                }
                success( serviceObj );
            } else {
                console.log( "Failed GattComms connection" );
                failure( "Could not connect to device. Make sure device is on and BT is activated" );
            }
        },
        function ( error ) {
            failure( error );
        }
    );
}

function getGATTServiceUuid( bleDevice, serviceUuid, success, failure ) {

    bleDevice.getGattServicesForUuidAsync( serviceUuid ).done(
        function ( result ) {
            if ( result.status === gatt.GattCommunicationStatus.success ) {
                var services = result.services;
                if ( result.services.length > 0 ) {
                    var serviceObj = {
                        uuid: services[0].uuid,
                        service: services[0]
                    };
                    success( serviceObj );
                    console.log( "Service: " + services[0].uuid );
                } else {
                    console.log( "Failed GattComms connection" );
                    failure( "GatComms received a successful communication status, but no services found" );
                }

            } else {
                console.log( "Failed GattComms connection" );
                failure( "GatComms received a failed communication status" );
            }
        },
        function ( error ) {
            failure( error );
        }
    );
}

function cacheGattServices( CACHE, services ) {
    for ( var svc in services ) {
        if ( !CACHE[svc] ) {
            CACHE[svc] = services[svc];
        }
    }
}

function cacheGattCharacteristics( CACHE, characteristics ) {
    for ( var ch in characteristics ) {
        if ( !CACHE[ch] ) {
            CACHE[ch] = characteristics[ch];
        }
    }
}

function getSelectedCharacteristicUuid( service, guid, callback ) {

    if ( service.session.sessionStatus === gatt.GattSessionStatus.active && guid ) {
        console.log( "Get selected characteristic for service: " + service.uuid + " >>> characteristic: " + guid );

        service.getCharacteristicsForUuidAsync( guid ).done(
            function ( found ) {
                if ( found.status === 0 && found.characteristics.length > 0 ) {
                    callback( found.characteristics[0] );
                } else {
                    callback( false );
                }
            },
            function ( error ) {
                callback( error );
            }
        );
    } else {
        //Need to get services for this device
        callback( false );
    }
}

function getAllCharacteristics( service, callback ) {

    if ( service.session.sessionStatus === gatt.GattSessionStatus.active ) {
        service.getCharacteristicsAsync().done(
            function ( characteristics ) {
                if ( characteristics.status === 0 ) {
                    callback( characteristics.characteristics );
                }
            },
            function ( error ) {
                callback( false );
            }
        );
    } else {
        callback( false );
    }
}

function checkUuid(uuid) {
    if ( uuid.length == 4 ) {
        return "0000" + uuid + "-0000-1000-8000-00805F9B34FB";
    } else {
        return uuid;
    }
}

//***HELPERS***
function onValueChanged( eventArgs, callback ) {
    var data = ua2hex( new Uint8Array( eventArgs.characteristicValue ) );
    console.log( "New value: " + data.toString() );
    callback( eventArgs.characteristicValue, { keepCallback: true } );
}

function returnEnum( result, object ) {
    var answer = -1;
    Object.keys( object ).forEach( function ( key ) {
        var value = object[key];
        if ( value === result ) {
            answer = key.toString();
        }
    } );
    return answer;
}

function ua2hex( ua ) {
    var h = [];
    for ( var i = 0; i < ua.length; i++ ) {
        h[i] = ( "0" + ua[i].toString( 16 ) ).substr( -2 );
    }
    return h;
}

//***Public functions
module.exports = {

    scan: function ( success, failure, args ) {
        //var thisServiceFilter = null;
        var scanTime = args[1] * 1000;
        serviceUuidFilter = null;
        successFn = success;
        failureFn = failure;
        //WATCH_CACHE = {};

        if ( args[0] && args[0].length > 0 ) {
            serviceUuidFilter = "{" + args[0].toString() + "}"; //thisServiceFilter
            //serviceUuidFilter = getSelector( thisServiceFilter ); //returns serviceUuidFilter
        }

        startWatcher();

        if ( scanTime && scanTime > 0 ) {
            scanTimer = setTimeout(
                function () {
                    stopWatcher();
                }, scanTime );
        }

    },

    startScan: function ( success, failure, svcs ) {
        var services = svcs;
        successFn = success;
        failureFn = failure;

        startWatcher();
    },

    startScanWithOptions: function ( success, failure, svcs, opts ) {
        var services = svcs;
        var options = opts;
        successFn = success;
        failureFn = failure;

        startWatcher();
    },

    stopScan: function ( success, failure ) {
        var isStopped = stopWatcher();
        if ( isStopped === true ) {
            success();
        } else {
            failure();
        }
    },

    list: function ( success, failure, args ) {

        console.log( deviceArray.length + " - devices in list." );
        success( deviceArray );
    },

    connect: function ( success, failure, args ) {
        var deviceID = args[0];

        if ( !WATCH_CACHE[deviceID] ) { //Device enumeration didn't find this or user didn't scan first but provided ID
            failure( "Device not found" );
            return;
        }
        console.log( "Attempting to connect..." );

        function cacheGatt( services ) { //Step 3
            cacheGattServices( WATCH_CACHE[deviceID].services, services ); //Cache services for fast reference
            setBLEStatusListener( WATCH_CACHE[deviceID].ble, success, failure );
            console.log( WATCH_CACHE[deviceID].ble );
            WATCH_CACHE[deviceID].ble.failure = failure;
            WATCH_CACHE[deviceID].ble.success = success;
        }

        function gatt( bleDevice ) { //Step 2
            WATCH_CACHE[deviceID].ble.ble = bleDevice; //Cache device for reference
            WATCH_CACHE[deviceID].services = {};
            getGATTServices( bleDevice, bluetooth.BluetoothCacheMode.uncached, cacheGatt, failure );
        }


        if ( WATCH_CACHE[deviceID].ble.ble.connectionStatus === bluetooth.BluetoothConnectionStatus.connected ) {
            bleDevice = WATCH_CACHE[deviceID].ble.ble;
            gatt( bleDevice );
        } else {
            getBLE( deviceID, gatt, failure ); //Step 1
        }

    },

    disconnect: function ( success, failure, args ) {
        var deviceID = args[0];

        stopWatcher();

        //Loop through each service and characterisitc and turn off any event listeners

        //for ( var svc in WATCH_CACHE[deviceID].services ) {
        //    if ( WATCH_CACHE[deviceID].services[svc].service.session.sessionStatus === gatt.GattSessionStatus.active ) {
        //        WATCH_CACHE[deviceID].services[svc].service.close();
        //        console.log( "Closing service: " + WATCH_CACHE[deviceID].services[svc].service.uuid );
        //    }
        //}

        console.log( "Removing event listener for BLE connection" );
        //WATCH_CACHE[deviceID].ble.ble.removeEventListener( 'connectionstatuschanged', WATCH_CACHE[deviceID].ble.listener );
        WATCH_CACHE[deviceID].ble.ble.close();

        success( deviceID );
    },

    read: function ( success, failure, args ) {
        //Reads the value of a characteristic.
        var deviceID = args[0];
        var characteristics = {
            SYSTEM: args[1],
            READ_TIMER: args[2]
        };
        //var data = args[3];

        //var ui8Data = new Uint8Array( data );
        var services;
        var uuid = checkUuid( characteristics.SYSTEM );
        var guid = checkUuid( characteristics.READ_TIMER );

        function thisReader( characteristic ) {
            if ( characteristic === false || characteristic.message) {
                failure( "Unable to map charcterisitcs for reading" );
                return;
            }

            if ( WATCH_CACHE[deviceID].services[uuid].service.session.sessionStatus === gatt.GattSessionStatus.active ) {
                // this is where the data is read
                characteristic.readValueAsync( bluetooth.BluetoothCacheMode.uncached ).done(
                    function ( result ) {
                        if ( result.status === gatt.GattCommunicationStatus.success ) {
                            success( result.value );
                        } else {
                            failure( "Unable to read" );
                        }
                    },
                    function ( error ) {
                        failure( "Unable to read: " + error );
                    }
                );
            }
        }

        function thisFailed( error ) {
            failure( error );
        }

        function getLocalCharacteristic( service ) {
            if ( service ) {
                WATCH_CACHE[deviceID].services[uuid] = {};
                WATCH_CACHE[deviceID].services[uuid] = service;
            }
            var thisService = WATCH_CACHE[deviceID].services[uuid].service;
            getSelectedCharacteristicUuid( thisService, guid, thisReader );
        }

        console.log( "Read for service: " + uuid + " >>> characteristic: " + guid );
        if ( !WATCH_CACHE[deviceID].services[uuid] ) {
            var bleDevice = WATCH_CACHE[deviceID].ble.ble;
            getGATTServiceUuid( bleDevice, uuid, getLocalCharacteristic, thisFailed );
        } else {
            getLocalCharacteristic();
        }

    },

    readRSSI: function ( success, failure, args ) {
        failure( "Not yet implemented..." );
    },

    write: function ( success, failure, args ) {
        //Writes data to a characteristic.
        var deviceID = args[0];
        var characteristics = {
            SYSTEM: args[1],
            READ_TIMER: args[2]
        };
        var buffer = args[3];

        //var data = ua2hex( new Uint8Array( buffer ) );

        var ui8Data = new Uint8Array( buffer );

        var uuid = checkUuid( characteristics.SYSTEM );
        var guid = checkUuid( characteristics.READ_TIMER );

        function thisWriter( characteristic ) {
            if ( characteristic === false || characteristic.message ) {
                failure( "Unable to map charcterisitcs for writing" );
                return;
            }
            var writer = new Windows.Storage.Streams.DataWriter();
            writer.writeBytes( ui8Data );

            if ( WATCH_CACHE[deviceID].services[uuid].service.session.sessionStatus === gatt.GattSessionStatus.active ) {
                // this is where the data is sent
                characteristic.writeValueAsync( writer.detachBuffer(), gatt.GattWriteOption.writeWithResponse ).done(
                    function ( result ) {
                        if ( result === gatt.GattCommunicationStatus.success ) {
                            //console.log( "wrote this data: " + data.toString() );
                            success();
                        } else {
                            failure( "Unable to write" );
                        }
                    }
                );
            }
        }

        function thisFailed( error ) {
            failure( error );
        }

        function getLocalCharacteristic( service ) {
            if ( service ) {
                WATCH_CACHE[deviceID].services[uuid] = {};
                WATCH_CACHE[deviceID].services[uuid] = service;
            }
            var thisService = WATCH_CACHE[deviceID].services[uuid].service;
            getSelectedCharacteristicUuid( thisService, guid, thisWriter );
        }

        console.log( "Write for service: " + uuid + " >>> characteristic: " + guid );

        if ( !WATCH_CACHE[deviceID].services[uuid] ) {
            var bleDevice = WATCH_CACHE[deviceID].ble.ble;
            getGATTServiceUuid( bleDevice, uuid, getLocalCharacteristic, thisFailed );
        } else {
            getLocalCharacteristic();
        }

    },

    writeWithoutResponse: function ( success, failure, args ) {
        //Writes data to a characteristic.
        var deviceID = args[0];
        var characteristics = {
            SYSTEM: args[1],
            READ_TIMER: args[2]
        };
        var buffer = args[3];

        //var data = ua2hex( new Uint8Array( buffer ) );

        var ui8Data = new Uint8Array( buffer );

        var uuid = checkUuid( characteristics.SYSTEM );
        var guid = checkUuid( characteristics.READ_TIMER );

        function send( characteristic ) {
            if ( characteristic === false || characteristic.message ) {
                failure( "Unable to map charcterisitcs for writing" );
                return;
            }
            var writer = new Windows.Storage.Streams.DataWriter();
            writer.writeBytes( ui8Data );

            // this is where the data is sent
            if ( WATCH_CACHE[deviceID].services[uuid].service.session.sessionStatus === gatt.GattSessionStatus.active ) {
                characteristic.writeValueAsync( writer.detachBuffer(), gatt.GattWriteOption.writeWithoutResponse ).done(
                    function ( result ) {
                        if ( result === gatt.GattCommunicationStatus.success ) {
                            //console.log( "wrote this data: " + data.toString() );
                            success();
                        } else {
                            failure( "Unable to write" );
                        }
                    }
                );
            }
        }

        function thisFailed( error ) {
            failure( error );
        }

        function getLocalCharacteristic( service ) {
            if ( service ) {
                WATCH_CACHE[deviceID].services[uuid] = {};
                WATCH_CACHE[deviceID].services[uuid] = service;
            }
            var thisService = WATCH_CACHE[deviceID].services[uuid].service;
            getSelectedCharacteristicUuid( thisService, guid, send );
        }

        console.log( "Write without response for service: " + uuid + " >>> characteristic: " + guid );

        if ( !WATCH_CACHE[deviceID].services[uuid].service ) {
            var bleDevice = WATCH_CACHE[deviceID].ble.ble;
            getGATTServiceUuid( bleDevice, uuid, getLocalCharacteristic, thisFailed );
        } else {
            getLocalCharacteristic();
        }

    },

    notify: function ( success, failure, args ) {
        failure( "Not yet implemented..." );
    },

    startNotification: function ( success, failure, args ) {
        //Function startNotification registers a callback that is called every time the value of a characteristic changes. This method handles both notifications and indications. The success callback is called multiple times.
        var deviceID = args[0];
        var characteristics = {
            SYSTEM: args[1],
            READ_TIMER: args[2]
        };

        var uuid = checkUuid( characteristics.SYSTEM );
        var guid = checkUuid( characteristics.READ_TIMER );

        function thisNotifier( characteristic ) {
            if ( characteristic === false || characteristic.message ) {
                failure( "Characteristic (guid) not found!" );
                return;
            }

            //Cache this so we can turn off the specific notification later
            if ( !WATCH_CACHE[deviceID].services[uuid].characteristics ) {
                WATCH_CACHE[deviceID].services[uuid].characteristics = {};
            }
            WATCH_CACHE[deviceID].services[uuid].characteristics[guid] = {};
            WATCH_CACHE[deviceID].services[uuid].characteristics[guid].characteristic = characteristic;

            var gattClientCharacteristic = returnEnum( characteristic.characteristicProperties, Windows.Devices.Bluetooth.GenericAttributeProfile.GattCharacteristicProperties );

            if ( gattClientCharacteristic === -1 ) {
                if ( characteristic.characteristicProperties === 40 ) {
                    gattClientCharacteristic = gatt.GattClientCharacteristicConfigurationDescriptorValue.indicate;
                } else {
                    gattClientCharacteristic = gatt.GattClientCharacteristicConfigurationDescriptorValue.notify;
                }
            }

            if ( WATCH_CACHE[deviceID].services[uuid].service.session.sessionStatus === gatt.GattSessionStatus.active ) {
                characteristic.writeClientCharacteristicConfigurationDescriptorAsync( gattClientCharacteristic ).done(
                    function ( gattResult ) {
                        if ( gattResult === gatt.GattCommunicationStatus.success ) {
                            characteristic.onvaluechanged = function ( onChangeResult ) {
                                //var data = ua2hex( new Uint8Array( onChangeResult.characteristicValue ) );
                                //console.log( "New value: " + data.toString() );
                                success( onChangeResult.characteristicValue, { keepCallback: true } );
                            };
                            //console.log( "onvaluechanged: " + characteristic.onvaluechanged );
                            console.log( "Start Notification for service: " + uuid + " >>> characteristic: " + guid + " : for : " + gattClientCharacteristic );
                        } else {
                            failure( "Error registering for: " + gattClientCharacteristic );
                        }
                    },
                    function ( error ) {
                        failure( "Error registering for: " + gattClientCharacteristic );
                    }
                );
            }
        }

        function thisFailed( error ) {
            failure( error );
        }

        function getLocalCharacteristic( service ) {
            if ( service ) {
                WATCH_CACHE[deviceID].services[uuid] = {};
                WATCH_CACHE[deviceID].services[uuid] = service;
            }
            var thisService = WATCH_CACHE[deviceID].services[uuid].service;
            getSelectedCharacteristicUuid( thisService, guid, thisNotifier );
        }

        if ( !WATCH_CACHE[deviceID].services[uuid] ) {
            var bleDevice = WATCH_CACHE[deviceID].ble.ble;
            getGATTServiceUuid( bleDevice, uuid, getLocalCharacteristic, thisFailed );
        } else {
            getLocalCharacteristic();
        }

    },

    stopNotification: function ( success, failure, args ) {
        //Function stopNotification stops a previously registered notification callback.
        var deviceID = args[0];
        var characteristics = {
            SYSTEM: args[1],
            READ_TIMER: args[2]
        };

        var uuid = checkUuid( characteristics.SYSTEM );
        var guid = checkUuid( characteristics.READ_TIMER );
		
        var characteristic = WATCH_CACHE[deviceID].services[uuid].characteristics[guid].characteristic;

            if ( characteristic && WATCH_CACHE[deviceID].services[uuid].service.session.sessionStatus === gatt.GattSessionStatus.active ) {
            console.log( "Stop Notification for service: " + uuid + " >>> characteristic: " + guid );
            characteristic.onvaluechanged = null;
            //characteristic.removeEventListener( "valueChanged", onValueChanged );

            characteristic.writeClientCharacteristicConfigurationDescriptorAsync( gatt.GattClientCharacteristicConfigurationDescriptorValue.none ).done(
                function ( result ) {
                    if ( result === gatt.GattCommunicationStatus.success ) {
                        success( "Unsubscribed" );
                    } else {
                        failure( "Device unreachable." );
                    }
                },
                function ( error ) {
                    success( "Already closed" );
                }
            );
        } else {
            failure( "Characteristic: " + guid + " not found" );
        }

    },

    isConnected: function ( success, failure, args ) {
        var deviceID = args[0];

        console.log( "Checking if connected..." );
        if ( !WATCH_CACHE[deviceID].ble.ble ) {
            failure( "No BLE device found" );
            return;
        }

        var pMsg = returnEnum( WATCH_CACHE[deviceID].ble.ble.connectionStatus, Windows.Devices.Bluetooth.BluetoothConnectionStatus );

        console.log( "isConnected: " + pMsg );

        if ( WATCH_CACHE[deviceID].ble.ble.connectionStatus === bluetooth.BluetoothConnectionStatus.connected ) {
            success( true );
        } else {
            failure( "Not Connected to BT device" );
        }
    },

    isEnabled: function ( success, failure ) {
        var access;
        var adapter;
        var btradio;

        try {
            Windows.Devices.Radios.Radio.requestAccessAsync().then( function ( access ) {
                if ( access !== Windows.Devices.Radios.RadioAccessStatus.allowed ) {
                    failure( "Access to bluetooth radio not allowed" );
                } else {
                    bluetooth.BluetoothAdapter.getDefaultAsync().then( function ( adapter ) {
                        if ( adapter !== null ) {
                            adapter.getRadioAsync().then( function ( btRadio ) {
                                if ( btRadio.state === Windows.Devices.Radios.RadioState.on ) {
                                    success();
                                } else {
                                    failure( "Bluetooth is not enabled" );
                                }
                            } );
                        } else {
                            failure( "No bluetooth radio found" );
                        }
                    } );
                }
            } ).done();
        } catch ( err ) {
            failure( "Connection to bluetooth failed: " + err );
        }
    },

    enable: function ( success, failure ) {
        var access;
        var adapter;
        var btradio;

        try {
            access = Windows.Devices.Radios.Radio.requestAccessAsync().then( function ( access ) {
                if ( access !== Windows.Devices.Radios.RadioAccessStatus.allowed ) {
                    failure( "Access to bluetooth radio not allowed" );
                } else {
                    adapter = bluetooth.BluetoothAdapter.getDefaultAsync().then( function ( adapter ) {
                        if ( adapter !== null ) {
                            btRadio = adapter.getRadioAsync().then( function ( btRadio ) {
                                if ( btRadio.state === Windows.Devices.Radios.RadioState.off ) {
                                    btRadio.setStateAsync( RadioState.on ).then( function ( btRadio ) {
                                        if ( btRadio.state === Windows.Devices.Radios.RadioState.on ) {
                                            success();
                                        } else {
                                            failure( "Failed to activate bluetooth radio" );
                                        }
                                    } );
                                } else {
                                    console.log( "Bluetooth is already enabled!" );
                                    success();
                                }
                            } );
                        } else {
                            failure( "No bluetooth radio found" );
                        }
                    } );
                }
            } ).done();
        } catch ( err ) {
            failure( "Connection to bluetooth failed: " + err );
        }
    },

    showBluetoothSettings: function ( success, failure, args ) {
        failure( "Not yet implemented..." );
    },

    startStateNotifications: function ( success, failure ) {
        failure( "Not yet implemented..." );
    },

    stopStateNotifications: function ( success, failure ) {
        //Function stopNotification stops a previously registered notification callback.
        failure( "Not yet implemented..." );
    }
};

require( "cordova/exec/proxy" ).add( "BLE", module.exports );
