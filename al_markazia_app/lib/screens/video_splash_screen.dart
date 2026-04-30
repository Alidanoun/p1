import 'dart:async';
import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';
import '../services/storage_service.dart';
import '../services/session_service.dart';
import 'main_nav_screen.dart';
import 'auth_screen.dart';
import 'language_selection_screen.dart';
import 'package:provider/provider.dart';
import '../features/auth/auth_controller.dart';

class VideoSplashScreen extends StatefulWidget {
  const VideoSplashScreen({Key? key}) : super(key: key);

  @override
  State<VideoSplashScreen> createState() => _VideoSplashScreenState();
}

class _VideoSplashScreenState extends State<VideoSplashScreen> {
  late VideoPlayerController _controller;
  bool _hasNavigated = false;
  bool _videoReadyToShow = false; 
  Timer? _safetyTimer;

  @override
  void initState() {
    super.initState();
    
    // 1. Initialize Video Controller
    _controller = VideoPlayerController.asset('assets/videos/splash_video_official.mp4');
    
    _controller.initialize().then((_) {
      if (mounted) {
        // Start playing immediately in background
        _controller.setVolume(0.0);
        _controller.play();
        
        // Add listener to continuously monitor progress until it finishes
        _controller.addListener(_videoListener);
      }
    }).catchError((error) {
      debugPrint("Splash Video Init Error: $error");
      _handleNavigation(); // Emergency fallback if video file is broken
    });

    // 2. Safety Timeout (Prevents getting stuck if something freezes)
    _safetyTimer = Timer(const Duration(seconds: 15), () {
      _handleNavigation();
    });
  }

  // The continuous listener 
  void _videoListener() {
    if (!mounted || _hasNavigated) return;
    
    // Once the video moves past 0, make it visible. 
    if (_controller.value.position > Duration.zero && _controller.value.isPlaying) {
      if (!_videoReadyToShow) {
        setState(() {
          _videoReadyToShow = true;
        });
      }
    }
    
    // Continuously check if video has finished
    if (_controller.value.duration > Duration.zero &&
        _controller.value.position >= _controller.value.duration) {
      
      // Navigate IMMEDIATELY when video finishes (at 7 seconds)
      _handleNavigation();
    }
  }

  void _handleNavigation() {
    if (_hasNavigated) return;
    _hasNavigated = true;
    
    setState(() {
      _videoReadyToShow = false; 
    });

    _safetyTimer?.cancel();
    _controller.removeListener(_videoListener);

    final storage = StorageService.instance;
    final auth = context.read<AuthController>();
    
    // AuthController.initialize has its own guard now, so this is safe and clean.
    auth.initialize().then((_) {
      if (!mounted) return;

      Widget nextScreen;
      if (!storage.hasSelectedLanguage()) {
        nextScreen = const LanguageSelectionScreen();
      } else {
        switch (auth.status) {
          case AuthStatus.authenticated:
            nextScreen = const MainNavScreen();
            break;
          default:
            nextScreen = const AuthScreen();
            break;
        }
      }

      Future.delayed(const Duration(milliseconds: 300), () {
        if (mounted) {
          Navigator.of(context).pushReplacement(
            PageRouteBuilder(
              pageBuilder: (context, animation, secondaryAnimation) => nextScreen,
              transitionsBuilder: (context, animation, secondaryAnimation, child) {
                return FadeTransition(opacity: animation, child: child);
              },
              transitionDuration: const Duration(milliseconds: 800),
            ),
          );
        }
      });
    });
  }

  @override
  void dispose() {
    _safetyTimer?.cancel();
    _controller.removeListener(_videoListener);
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black, 
      body: SizedBox.expand(
        child: AnimatedOpacity(
          opacity: _videoReadyToShow ? 1.0 : 0.0,
          duration: const Duration(milliseconds: 300),
          child: _controller.value.isInitialized
            ? FittedBox(
                fit: BoxFit.contain, 
                child: SizedBox(
                  width: _controller.value.size.width,
                  height: _controller.value.size.height,
                  child: VideoPlayer(_controller),
                ),
              )
            : const SizedBox.shrink(),
        ),
      ),
    );
  }
}
