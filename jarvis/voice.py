"""Optional terminal voice mode (no browser). Needs: pip install SpeechRecognition pyttsx3 PyAudio"""


def run(j):
    try:
        import pyttsx3
        import speech_recognition as sr
    except ImportError:
        print("Terminal voice mode needs extra packages:\n  pip install SpeechRecognition pyttsx3 PyAudio\n"
              "Or simply run 'python jarvis.py' and use the browser HUD, which needs nothing extra.")
        return
    engine = pyttsx3.init()
    recogniser = sr.Recognizer()

    def say(text):
        print(f"{j.cfg['assistant_name']}: {text}")
        engine.say(text)
        engine.runAndWait()

    say(j.handle("hello")["speech"])
    while True:
        with sr.Microphone() as source:
            print("Listening...")
            recogniser.adjust_for_ambient_noise(source, duration=0.4)
            audio = recogniser.listen(source, phrase_time_limit=12)
        try:
            text = recogniser.recognize_google(audio, language=j.cfg["language"])
        except sr.UnknownValueError:
            continue
        except sr.RequestError:
            say("Speech recognition is unavailable. Please check the internet connection.")
            continue
        print(f"You: {text}")
        reply = j.handle(text)
        if reply.get("voice"):
            voices = engine.getProperty("voices")
            if len(voices) > 1:
                engine.setProperty("voice", voices[1 if reply["voice"] == "female" else 0].id)
        say(reply["speech"])
        if reply.get("sleep"):
            break
