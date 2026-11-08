# Only the minified debug target uses this file. AndroidJUnitRunner lives in
# a separate APK and references Kotlin classes shared with the target app.
# R8 cannot see those references when optimizing the target.
-keep class kotlin.** { *; }
