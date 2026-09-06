package com.metor.mobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MetorPushPlugin.class);   // the app's own push plugin (ADR-0017)
        super.onCreate(savedInstanceState);
    }
}
