import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from './firebaseConfig';
import { collection, addDoc } from 'firebase/firestore';

const LOCATION_TASK_NAME = 'background-location-task';

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error("Background location error:", error);
    return;
  }

  if (data) {
    console.log('📡 Background task triggered with data:', data);
    const { locations } = data;
    const coords = locations[0]?.coords;

    if (coords) {
      try {
        const userName = await AsyncStorage.getItem('username');
        console.log('👤 Username in background task:', userName);

        if (!userName) {
          console.warn("No username found, skipping save.");
          return;
        }

        await addDoc(collection(db, 'users'), {  // changed 'user_locations' → 'users'
          name: userName,
          latitude: coords.latitude,
          longitude: coords.longitude,
          createdAt: new Date().toLocaleString('en-US', {
            timeZone: 'America/New_York',
          }),
        });

        console.log(`✅ Location saved for ${userName}`);
      } catch (err) {
        console.error("🔥 Error saving location:", err);
      }
    } else {
      console.warn("❌ No coordinates found in background task.");
    }
  }
});
