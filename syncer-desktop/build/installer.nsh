Function .onVerifyInstDir
  StrLen $0 "\${PRODUCT_NAME}"
  StrCpy $1 "$INSTDIR" "" -$0
  StrCmp $1 "\${PRODUCT_NAME}" +2 0
  StrCpy $INSTDIR "$INSTDIR\${PRODUCT_NAME}"
FunctionEnd
