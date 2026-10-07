plugins {
    id("com.android.application")
}

android {
    namespace = "com.landon.gevroad"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.landon.gevroad"
        // The head unit runs Android 9 (API 28). 26 is the floor for the adaptive icon.
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Personal sideload build: signed with this Mac's debug key so every
            // update installs over the previous one. Not for an app store.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.17.1")
}
