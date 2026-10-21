import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

// URL del servidor: clave api.base.url en mobile/local.properties (fuera de git). Nunca en el código.
val propiedadesLocales = Properties().apply {
    rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) }
}
val apiBaseUrl: String = propiedadesLocales.getProperty("api.base.url", "").trim()
    .let { if (it.isEmpty() || it.endsWith("/")) it else "$it/" }

// Commit corto para la línea "Versión · build · commit" de B7, que identifica el APK que tiene un
// celular en el campo. El "+" avisa de que se armó con cambios sin commitear, así que ese sha no lo
// reproduce. Sin git (o sin repo), queda "desconocido".
fun gitSalida(vararg orden: String): String? = try {
    providers.exec {
        commandLine(*orden)
        isIgnoreExitValue = true
    }.standardOutput.asText.get().trim().takeIf { it.isNotEmpty() }
} catch (e: Exception) {
    null
}

val gitCommit: String = gitSalida("git", "rev-parse", "--short", "HEAD")
    // --porcelain sale vacío con el árbol limpio y cuenta también los archivos sin seguir
    ?.plus(if (gitSalida("git", "status", "--porcelain") != null) "+" else "")
    ?: "desconocido"

android {
    namespace = "pe.queseria.campo"
    compileSdk = 36

    defaultConfig {
        applicationId = "pe.queseria.campo"
        minSdk = 26
        targetSdk = 36
        versionCode = 6
        versionName = "0.8.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "API_BASE_URL", "\"$apiBaseUrl\"")
        buildConfigField("String", "GIT_COMMIT", "\"$gitCommit\"")
    }

    buildTypes {
        release {
            // Release exige HTTPS: res/xml/network_security_config.xml no permite texto plano
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)
    implementation(libs.work.runtime.ktx)

    implementation(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.play.services.location)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation(libs.androidx.test.junit)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.room.testing)
    androidTestImplementation(libs.kotlinx.coroutines.test)
}
