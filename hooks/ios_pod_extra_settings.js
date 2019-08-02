var fs = require('fs');

//var podExtraSettings = `
//use_frameworks!
//post_install do |installer|
//  installer.pods_project.targets.each do |target|
//    target.build_configurations.each do |config|
//      config.build_settings['SWIFT_VERSION'] = '3.0'
//    end
//  end
//end
//`;

//fs.appendFile('platforms/ios/Podfile', podExtraSettings, function (err, data) {
//  if (err) {
//    console.log(err);
//    process.exit(1);
//  }
//});

var podExtraSettings = `
use_frameworks!
target 'iManifold' do
project 'iManifold.xcodeproj'
pod 'iOSDFULibrary'
end
`;
fs.truncate("platforms/ios/Podfile", 0, function () {
    fs.writeFile('platforms/ios/Podfile', podExtraSettings, function (err) {
        if (err) {
            return console.log("avi_error Pod File : " + err);
            process.exit(1);
        }
        else {
            console.log('Wrote target iManifold Hello World in file helloworld.txt Podfile, just check it');
        }
    });
});

//fs.appendFile('platforms/ios/Podfile', podExtraSettings, function (err, data) {
//    if (err) {
//        console.log(err);
//        process.exit(1);
//    }
//});
