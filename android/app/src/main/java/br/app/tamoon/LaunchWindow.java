package br.app.tamoon;

import android.os.Build;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;

/** Window setup for the native splash, before the browser takes over the TWA. */
public final class LaunchWindow {
    private LaunchWindow() {}

    public static void configure(Window window) {
        window.getDecorView();
        if (Build.VERSION.SDK_INT < 35) {
            WindowCompat.setDecorFitsSystemWindows(window, false);
        }
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams attributes = window.getAttributes();
            int mode = Build.VERSION.SDK_INT >= 30
                    ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            if (attributes.layoutInDisplayCutoutMode != mode) {
                attributes.layoutInDisplayCutoutMode = mode;
                window.setAttributes(attributes);
            }
        }
    }
}
