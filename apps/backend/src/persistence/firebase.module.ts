import { Global, Module } from '@nestjs/common';
import { FirestoreService } from './firestore.service';
import { LocalStore } from './local-store';

@Global()
@Module({ providers: [LocalStore, FirestoreService], exports: [LocalStore, FirestoreService] })
export class FirebaseModule {}
