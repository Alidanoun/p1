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

  /// Validates password security (matching the backend's strict regex requirements)
  static String? validatePassword(String? value, String errorMsgEmpty, String errorMsgInvalid) {
    if (value == null || value.trim().isEmpty) {
      return errorMsgEmpty;
    }
    
    // Requirements: Min 8 chars, 1 Uppercase, 1 Lowercase, 1 Number, 1 Special Char
    final passwordRegex = RegExp(r'^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#_\-])[A-Za-z\d@$!%*?&#_\-]{8,}$');
    if (!passwordRegex.hasMatch(value)) {
      return errorMsgInvalid;
    }
    return null;
  }

  /// Validates standard Email format
  static String? validateEmail(String? value, String errorMsgEmpty, String errorMsgInvalid) {
    if (value == null || value.trim().isEmpty) {
      return errorMsgEmpty;
    }
    final emailRegex = RegExp(r'^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$');
    if (!emailRegex.hasMatch(value.trim())) {
      return errorMsgInvalid;
    }
    return null;
  }
}
