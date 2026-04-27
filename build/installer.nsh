!macro tryInstallLocation ROOT KEY
  ${If} $R8 == "0"
    ReadRegStr $R9 ${ROOT} "${KEY}" "InstallLocation"
    ${If} $R9 != ""
      IfFileExists "$R9\${APP_EXECUTABLE_FILENAME}" 0 +3
        StrCpy $INSTDIR "$R9"
        StrCpy $R8 "1"
    ${EndIf}
  ${EndIf}
!macroend

!macro customInit
  StrCpy $R8 "0"

  ; Current installer identity is already handled by electron-builder.
  ; These compatibility probes catch early private builds whose appId or
  ; uninstall key differed from the public 1.1.x series.
  !insertmacro tryInstallLocation HKCU "Software\8f875fc0-2829-5116-b6a6-dce89515fd2a"
  !insertmacro tryInstallLocation HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\8f875fc0-2829-5116-b6a6-dce89515fd2a"
  !insertmacro tryInstallLocation HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\cn.tsinghua.learnpp"
  !insertmacro tryInstallLocation HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\learn++"
  !insertmacro tryInstallLocation HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\learn-plus-plus"

  !insertmacro tryInstallLocation HKLM "Software\8f875fc0-2829-5116-b6a6-dce89515fd2a"
  !insertmacro tryInstallLocation HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\8f875fc0-2829-5116-b6a6-dce89515fd2a"
  !insertmacro tryInstallLocation HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\cn.tsinghua.learnpp"
  !insertmacro tryInstallLocation HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\learn++"
  !insertmacro tryInstallLocation HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\learn-plus-plus"
!macroend
