//var app = WinJS.Application;
var bluetooth = Windows.Devices.Bluetooth;
var gatt = Windows.Devices.Bluetooth.GenericAttributeProfile;
var crypto = Windows.Security.Cryptography;


var service;
var serviceFilter;
var serviceInitialized = false;

var bluetoothLeDevice;

var DevEnum = Windows.Devices.Enumeration;
var deviceWatcher = null;
var deviceArray = [];
var isEnumerationComplete = false;

var serviceCollection = [];
var characteristicCollection = [];

//var selectedCharcUuid;

var listObj = {
    deviceID: "",
    selectedCharacteristic: {}
}

var listeners = [];

var successFn;
var failureFn;
var notifyCallback;
var scanTimer;
var connectTimer;
var isBusy = false;
var watcher;

// *** DEVICE ENUMERATION SECTION ***
function startWatcher() {

    // Get the device selector chosen by the UI then add additional constraints for devices that 
    // can be paired or are already paired.

    var selectedItem = {
        displayName: "Bluetooth LE",
        selectorBLE: "System.Devices.Aep.ProtocolId:=\"{bb7bb05e-5972-42b5-94fc-76eaa7084d49}\"",
        selectorBT: "System.Devices.Aep.ProtocolId:=\"{e0cbf06c-cd8b-4647-bb8a-263b43f0f974}\"",
        kind: Windows.Devices.Enumeration.DeviceInformationKind.associationEndpoint
    };
    var selector = "(" + selectedItem.selectorBLE + ")";

    var reqProperties = [];
    reqProperties[0] = "System.Devices.Aep.DeviceAddress";
    reqProperties[1] = "System.Devices.Aep.IsConnected";
    reqProperties[2] = "System.Devices.Aep.SignalStrength";

    deviceArray = [];
    deviceWatcher = DevEnum.DeviceInformation.createWatcher( selector, reqProperties, selectedItem.kind );

    // Add event handlers
    deviceWatcher.addEventListener( "added", onAdded, false );
    deviceWatcher.addEventListener( "updated", onUpdated, false );
    deviceWatcher.addEventListener( "removed", onRemoved, false );
    deviceWatcher.addEventListener( "enumerationcompleted", onEnumerationCompleted, false );
    deviceWatcher.addEventListener( "stopped", onStopped, false );

    console.log( "Starting watcher..." );

    try {
        deviceWatcher.start();
    } catch ( err ) {
        console.log( "deviceWatcher error: " + err );
    }

}

function stopWatcher() {
    var stopsuccess = true;

    clearTimeout( scanTimer );

    if ( deviceWatcher !== undefined ) {

        deviceWatcher.removeEventListener( "added", onAdded );
        deviceWatcher.removeEventListener( "updated", onUpdated );
        deviceWatcher.removeEventListener( "removed", onRemoved );
        deviceWatcher.removeEventListener( "enumerationcompleted", onEnumerationCompleted );
        deviceWatcher.removeEventListener( "stopped", onStopped );
        try {
            if ( DevEnum.DeviceWatcherStatus.started === deviceWatcher.status ||
                DevEnum.DeviceWatcherStatus.enumerationCompleted === deviceWatcher.status ) {
                deviceWatcher.stop();
                deviceWatcher = undefined;
            }
        } catch ( e ) {
            console.log( "Failed to stop watcher: " + e.message );
            stopsuccess = false;
        }
    }

    return stopsuccess;
}

function getDevice( deviceID ) {
    var len = deviceArray.length;

    for ( var i = 0; i < len; i++ ) {
        if ( deviceArray[i].id === deviceID ) {
            return deviceArray[i];
        }
    }
    return false;
}

function getService( uuid ) {
    var len = serviceCollection.length;

    for ( var i = 0; i < len; i++ ) {
        if ( serviceCollection[i].uuid === uuid ) {
            return serviceCollection[i];
        }
    }
    return false;
}

function getSelectedCharacteristicUuid( uuid, guid, callback ) {
    //selectedCharcUuid = uuid;
    //selectedCharacteristic = undefined;

    bluetoothLeDevice.getGattServicesForUuidAsync( uuid ).done(
        function ( svc ) {
            if ( svc.services.length > 0 ) {
                svc.services[0].getCharacteristicsForUuidAsync( guid ).done(
                    function ( charc ) {
                        if ( charc.characteristics.length > 0 ) {
                            var selectedCharacteristic = charc.characteristics[0]
                            callback( selectedCharacteristic );
                        } else {
                            callback( false );
                        }
                    } );
            } else {
                callback( false );
            }

        } );
}

function getListeners(deviceID) {
    var len = listeners.length;

    for ( var i = 0; i < len; i++ ) {
        var listObj = listeners[i];
        if ( listObj.deviceID = deviceID ) {
            return listObj.selectedCharacteristic;
        }
    }
    return false;
}

function removeListener( deviceID ) {
    var len = listeners.length;

    for ( var i = 0; i < len; i++ ) {
        if ( listeners[i].deviceID = deviceID ) {
            listeners.splice( i, 1 );
        }
    }
}

function onAdded( devinfo ) {

    var thisDevice = {
        advertising: {
            services: []
        },
        id: devinfo.id,
        name: devinfo.name,
        rssi: 0,
    };

    var uuid = "{" + serviceFilter[0] + "}";

    console.log( "onAdded: found a device: " + devinfo.name + " Device isEnabled: " + devinfo.isEnabled );

    function searchForUuid() {
        bluetooth.BluetoothLEDevice.fromIdAsync( devinfo.id ).done(
            function ( c_device ) {
                c_device.getGattServicesForUuidAsync( uuid ).done(
                    function ( result ) {
                        if ( result.services.length > 0 ) {
                            if ( scanTimer ) { clearTimeout( scanTimer ); }
                            bluetoothLeDevice = c_device;
                            if ( devinfo.name === "" ) {
                                devinfo.name = c_device.name;
                            }
                            console.log( "Search for Uuid: found a device: " + bluetoothLeDevice.name );
                            stopWatcher();
                            returnDevice();
                        }
                    } );
            }
        );
    }

    function returnDevice() {
        if ( devinfo.properties['System.Devices.Aep.SignalStrength'] !== null ) {
            thisDevice.rssi = devinfo.properties['System.Devices.Aep.SignalStrength'];
        }

        if ( getDevice( devinfo.id ) === false && devinfo.name !== "" ) {
            deviceArray.push( devinfo );
        }

        if ( serviceFilter.length > 0 ) {
            //No need for multiple callbacks, we found the device we were looking for
            successFn( thisDevice );
        } else {
            //keep callback, enumerating through all devices
            successFn( thisDevice, { keepCallback: true } );
        }
    }

    if ( serviceFilter.length > 0 ) {
        searchForUuid();
    } else {
        returnDevice();
    }
}

function onUpdated( devUpdate ) {
    // Find the corresponding updated DeviceInformation in the collection and pass the update object
    // to the Update method of the existing DeviceInformation. This automatically updates the object
    // for us.

    var updtDevice = getDevice( devUpdate.id );
    if ( updtDevice !== false ) {
        console.log( "onUpdated: This device updated:" + updtDevice.name );
        updtDevice.update( devUpdate );
    }
}

function onRemoved( devupdate ) {
    console.log( "onRemoved: removed a device:" + devupdate.id );

    for ( var i = 0; i < deviceArray.length; i++ ) {
        if ( deviceArray[i].id === devupdate.id ) {
            deviceArray.splice( i, 1 );
        }
    }

    console.log( deviceArray.length + " devices found. Watching for updates..." );
}

function onEnumerationCompleted( obj ) {
    isEnumerationComplete = true;
    console.log( deviceArray.length + " devices found. Enumeration completed. Watching for updates..." );
}

function onStopped( obj ) {
    var msg = '';
    if ( deviceWatcher.status === Windows.Devices.Enumeration.DeviceWatcherStatus.aborted ) {
        msg = 'Enumeration stopped unexpectedly.';
    } else if ( deviceWatcher.status === Windows.Devices.Enumeration.DeviceWatcherStatus.stopped ) {
        msg = 'You requested to stop enumeration';
    }
    console.log( 'onStopped message: ' + msg );
    console.log( deviceArray.length + " devices found. Watcher stopped" );
}

function pairDevice( success, failure ) {
    if ( deviceSelected.pairing.isPaired === true ) {
        console.log( "Already paired with " + deviceSelected.name );
        success();
    } else if ( deviceSelected.pairing.canPair === true ) {
        var pMsg = "Not properly paired";
        deviceSelected.pairing.pairAsync().done(
            function ( pairingResult ) {
                if ( connectTimer ) { clearTimeout( connectTimer ); }
                pMsg = returnEnum( pairingResult.status, DevEnum.DevicePairingResultStatus );
                console.log( "Pairing result with " + deviceSelected.name + " = " + pMsg );
                if ( pairingResult.status === DevEnum.DevicePairingResultStatus.paired ) {
                    isBusy = false;
                    setTimeout( success, 100 );
                } else {
                    failure( "Error msg: " + pMsg );
                }
            } );
    } else { //not able to pair
        console.log( "Not able to pair with this device: " + deviceSelected.name );
        failure( "Not able to pair with this device: " + deviceSelected.name );
    }
}

function onCharacteristicValueChanged( evt, callback ) {
    var data = ua2hex( new Uint8Array( evt.characteristicValue ) );
    console.log( "New value: " + data.toString());
    notifyCallback( evt.characteristicValue, { keepCallback: true } );
}

function returnEnum( result, object ) {
    var answer;
    Object.keys( object ).forEach( function ( key ) {
        var value = object[key];
        if ( value === result ) {
            answer = key.toString();
        }
    } );
    return answer;
}

function clearBLEDevice() {
    if ( bluetoothLeDevice ) {
        bluetoothLeDevice.close();
        bluetoothLeDevice = undefined;
    }   
}

function ua2hex( ua ) {
    var h = [];
    for ( var i = 0; i < ua.length; i++ ) {
        h[i] = ( "0" + ua[i].toString( 16 ) ).substr( -2 );
    }
    return h;
}

module.exports = {

    scan: function ( success, failure, args ) {
        serviceFilter = args[0];
        var scanTime = args[1] * 1000;
        successFn = success;
        failureFn = failure;
        deviceArray = [];

        startWatcher();
        scanTimer = setTimeout(
            function () {
                stopWatcher();
            }, scanTime );

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
        var deviceSelected = getDevice( deviceID );
        var data = [];
        var len = deviceArray.length;
        var isBusy = false;

        if ( deviceSelected === false ) {
            failure( "Device not found" );
            return;
        }

        console.log( "Attempting to connect..." );

        function getGATT() {
            serviceCollection = [];
            bluetoothLeDevice.getGattServicesAsync( bluetooth.BluetoothCacheMode.uncached ).done(
                function ( result ) {
                    if ( result.status === gatt.GattCommunicationStatus.success ) {
                        var services = result.services;
                        var len = services.length;
                        console.log( "GattServices - found: " + len + " services" );
                        for ( var i = 0; i < len; i++ ) {
                            serviceCollection.push( services[i] );
                            console.log( "Service: " + services[i].uuid );
                        }
                        
                        success( bluetoothLeDevice );
                    } else {
                        console.log( "Failed GattComms connection" );
                        failure( "Could not connect to device. Make sure device is on and BT is activated" );
                    }
                }
            );
        }

        function getBLE() {
            try {
                bluetooth.BluetoothLEDevice.fromIdAsync( deviceSelected.id ).done(
                    function ( deviceInfo ) {
                        console.log( "BluetoothLeDevice object created" );
                        bluetoothLeDevice = deviceInfo;
                        setTimeout( getGATT, 100 );
                        
                    }
                );
                
            } catch ( err ) { //In case radio is off
                failure( "Error: " + err );
            }
        }

        clearBLEDevice();
        getBLE();
        //pairDevice(getBLE, failure);
    },

    disconnect: function ( success, failure, args ) {
        var deviceID = args[0];
        var data = [];
        var stats = 0;

        console.log( "Stopping watcher. Please wait..." );
        stopWatcher();
        console.log( "Closing bluetooth connection. Please wait..." );

        var selectedCharacteristic = getListeners( deviceID );

        if ( selectedCharacteristic ) {
            selectedCharacteristic.removeEventListener( "valuechanged", onCharacteristicValueChanged, false );
            removeListener( deviceID );
        }

        clearBLEDevice();

        success( data );
    },

    read: function ( success, failure, args ) {
        //Reads the value of a characteristic.
        var deviceID = args[0];
        var characteristics = {
            system: args[1],
            readTimer: args[2]
        };
        var data = args[3];

        var ui8Data = new Uint8Array( data );
        var services;
        var uuid = "{" + characteristics.system + "}";
        //var selectedCharacteristic;

        function read( selectedCharacteristic ) {
            if ( selectedCharacteristic === false ) {
                failure( "Unable to map charcterisitcs for reading" );
                return;
            }
            try {
                // this is where the data is read

                selectedCharacteristic.readValueAsync( bluetooth.BluetoothCacheMode.uncached ).done(
                    function ( result ) {
                        if ( result.status === gatt.GattCommunicationStatus.success ) {
                            success( result );
                        } else {
                            failure( "Unable to read" );
                        }
                    } );
            } catch ( error ) {
                console.log( "Reading failed with error: " + error );
            }
        }

        getSelectedCharacteristicUuid( uuid, read );

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

        var data = ua2hex( new Uint8Array( buffer ) );

        var ui8Data = new Uint8Array( buffer );

        var uuid = "{" + characteristics.SYSTEM + "}";
        var guid = "{" + characteristics.READ_TIMER + "}";

        function send( selectedCharacteristic ) {
            if ( selectedCharacteristic === false ) {
                failure( "Unable to map charcterisitcs for writing" );
                return;
            }
            try {
                var writer = new Windows.Storage.Streams.DataWriter();
                writer.writeBytes( ui8Data );

                // this is where the data is sent
                selectedCharacteristic.writeValueAsync( writer.detachBuffer() ).done(
                    function ( result ) {
                        if ( result === gatt.GattCommunicationStatus.success ) {
                            console.log( "wrote this data: " + data.toString() );
                            success();
                        } else {
                            failure( "Unable to write" );
                        }
                    } );
            } catch ( error ) {
                failure( "Writing failed with error: " + error );
            }
        }

        getSelectedCharacteristicUuid( uuid, guid, send );
    },

    writeWithoutResponse: function ( success, failure, args ) {
        //Writes data to a characteristic.
        var deviceID = args[0];
        var characteristics = {
            SYSTEM: args[1],
            READ_TIMER: args[2]
        };
        var buffer = args[3];

        var data = ua2hex( new Uint8Array( buffer ) );

        var ui8Data = new Uint8Array( buffer );

        var uuid = "{" + characteristics.SYSTEM + "}";
        var guid = "{" + characteristics.READ_TIMER + "}";

        function ua2hex( ua ) {
            var h = [];
            for ( var i = 0; i < ua.length; i++ ) {
                h[i] = ( "0" + ua[i].toString( 16 ) ).substr( -2 );
            }
            return h;
        }

        function send( selectedCharacteristic ) {
            if ( selectedCharacteristic === false ) {
                failure( "Unable to map charcterisitcs for writing" );
                return;
            }
            try {
                var writer = new Windows.Storage.Streams.DataWriter();
                writer.writeBytes( ui8Data );

                // this is where the data is sent
                selectedCharacteristic.writeValueAsync( writer.detachBuffer() ).done(
                    function ( result ) {
                        if ( result === gatt.GattCommunicationStatus.success ) {
                            console.log( "wrote this data: " + data.toString() );
                            success();
                        } else {
                            failure( "Unable to write" );
                        }
                    } );
            } catch ( error ) {
                failure( "Writing failed with error: " + error );
            }
        }

        getSelectedCharacteristicUuid( uuid, guid, send );
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

        var uuid = "{" + characteristics.SYSTEM + "}";
        var guid = "{" + characteristics.READ_TIMER + "}";

        notifyCallback = success;

        function makeListener( selectedCharacteristic ) {
            if ( selectedCharacteristic ) {
                var descriptor = selectedCharacteristic.getAllDescriptors();
                var properties = returnEnum( selectedCharacteristic.characteristicProperties, Windows.Devices.Bluetooth.GenericAttributeProfile.GattCharacteristicProperties );

                selectedCharacteristic.readClientCharacteristicConfigurationDescriptorAsync().done(
                    function ( descriptors ) {
                        var gattClientCharacteristic;

                        if ( descriptors.clientCharacteristicConfigurationDescriptor === gatt.GattClientCharacteristicConfigurationDescriptorValue.none ) { //none 
                            gattClientCharacteristic = gatt.GattClientCharacteristicConfigurationDescriptorValue.none;
                        } else if ( descriptors.clientCharacteristicConfigurationDescriptor === gatt.GattClientCharacteristicConfigurationDescriptorValue.indicate ) {// indicate
                            gattClientCharacteristic = gatt.GattClientCharacteristicConfigurationDescriptorValue.indicate;
                        } else if ( descriptors.clientCharacteristicConfigurationDescriptor === gatt.GattClientCharacteristicConfigurationDescriptorValue.notify ) {//Notify
                            gattClientCharacteristic = gatt.GattClientCharacteristicConfigurationDescriptorValue.notify;
                        } else if ( descriptors.clientCharacteristicConfigurationDescriptor > 1 ) {//Notify
                            gattClientCharacteristic = gatt.GattClientCharacteristicConfigurationDescriptorValue.notify;
                        }else {
                            failure( "StartNotification Error: Unable to determine client descriptors" );
                            return;
                        }

                        selectedCharacteristic.writeClientCharacteristicConfigurationDescriptorAsync( gattClientCharacteristic ).done(
                            function ( result ) {
                                if ( result === gatt.GattCommunicationStatus.success ) {
                                    selectedCharacteristic.addEventListener( "valuechanged", onCharacteristicValueChanged, false );
                                    var listObj = {
                                        deviceID: deviceID,
                                        selectedCharacteristic: selectedCharacteristic
                                    }
                                    listeners.push( listObj );
                                } else {
                                    failure( "Error registering for indications" );
                                }
                            } );
                        return;
                    }
                );

            } else {
                failure( "Failed to StartNotifications" )
            }
        }

        getSelectedCharacteristicUuid( uuid, guid, makeListener );

    },

    stopNotification: function ( success, failure, args ) {
        //Function stopNotification stops a previously registered notification callback.
        notifyCallback = undefined;
        if ( selectedCharacteristic ) {
            selectedCharacteristic.removeEventListener( "valuechanged", onCharacteristicValueChanged, false );
        }
    },

    isConnected: function ( success, failure, args ) {
        var deviceID = args[0];
        var deviceDispInfo;
        var len = deviceArray.length;

        console.log( "Checking if connected..." );
        if ( !bluetoothLeDevice ) {
            failure( "Not Connected to BT device" );
            return;
        }

        var pMsg = pMsg = returnEnum( bluetoothLeDevice.connectionStatus, Windows.Devices.Bluetooth.BluetoothConnectionStatus );
        console.log( "isConnected: " + pMsg );

        if ( bluetoothLeDevice.connectionStatus === Windows.Devices.Bluetooth.BluetoothConnectionStatus.connected ) {
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
            access = Windows.Devices.Radios.Radio.requestAccessAsync().then( function ( access ) {
                if ( access !== Windows.Devices.Radios.RadioAccessStatus.allowed ) {
                    failure( "Access to bluetooth radio not allowed" );
                } else {
                    adapter = bluetooth.BluetoothAdapter.getDefaultAsync().then( function ( adapter ) {
                        if ( adapter !== null ) {
                            btRadio = adapter.getRadioAsync().then( function ( btRadio ) {
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
                                            failure( "Failed to activate bluetooth radio" )
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
}

require( "cordova/exec/proxy" ).add( "BLE", module.exports );
