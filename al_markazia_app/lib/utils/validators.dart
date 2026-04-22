class Validators {
  /// Validates standard required fields
  static String? validateRequired(String? value, String errorMsg) {
    if (value == null || value.trim().isEmpty) {
      return errorMsg;
    }
    return null;
  }

  /// Validates Jordan phone number format (starts with 07, 10 digits)
  static String? validatePhone(String? value, String errorMsgEmpty, String errorMsgInvalid) {
    if (value == null || value.trim().isEmpty) {
      return errorMsgEmpty;
    }
    
    // Strict Jordan format check (077XXXXXXX, 078XXXXXXX, 079XXXXXXX)
    final phoneRegex = RegExp(r'^07[789]\d{7}$');
    if (!phoneRegex.hasMatch(value.trim())) {
      return errorMsgInvalid;
    }
    return null;
  }

  /// Validates Name fields (minimum 2 chars)
  static String? validateName(String? value, String errorMsgEmpty, String errorMsgInvalid) {
    if (value == null || value.trim().isEmpty) {
      return errorMsgEmpty;
    }
    if (value.trim().length < 2) {
      return errorMsgInvalid;
    }
    return null;
  }

  /// Validates password security
  static String? validatePassword(String? value, String errorMsgEmpty, String errorMsgShort) {
    if (value == null || value.trim().isEmpty) {
      return errorMsgEmpty;
    }
    if (value.trim().length < 6) {
      return errorMsgShort; // E.g., 'Password must be at least 6 characters'
    }
    return null;
  }
}
