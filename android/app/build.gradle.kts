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
        versionCode = 24
        versionName = "0.3.17"
        // Conscrypt ships native code; the head unit (MT8163) and the test emulator are ARM.
        ndk {
            abiFilters += listOf("armeabi-v7a", "arm64-v8a")
        }
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
    // TLS 1.3 for NativeHttp on Android 9 (its own TLS stops at 1.2).
    implementation("org.conscrypt:conscrypt-android:2.7.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
