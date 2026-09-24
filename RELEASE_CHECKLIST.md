# RideOn Production Release Checklist

This checklist prepares the existing RideOn mobile/backend implementation for Android and iOS release. It does not publish, submit, reset the database, or bypass authentication/payment verification.

## PRE-RELEASE

- [ ] Render backend healthy: `GET /health` returns OK
- [ ] Required production database migrations applied successfully
- [ ] Production payment provider configured and live adapter verified
- [ ] Payment webhook configured in provider dashboard and verified against the real signed payload
- [ ] Android and iOS Google Maps SDK keys configured and application-restricted
- [ ] Production API URL configured in EAS as `EXPO_PUBLIC_API_URL`
- [ ] All Render secrets configured only on Render
- [ ] Authentication tested on a release build
- [ ] Booking creation/concurrency tested
- [ ] Cancellation/refund tested with the real provider in staging
- [ ] Security deposit hold/inspection/refund tested
- [ ] Live delivery tracking tested on physical Android/iOS devices
- [ ] Reviews tested
- [ ] Support tested
- [ ] Admin/Ops tested
- [ ] No localhost/development URLs in the production Expo config
- [ ] No mock payment provider enabled in production

## ANDROID

- [ ] Application ID verified: `com.rideon.app`
- [ ] EAS Android signing credentials configured
- [ ] Production AAB built with `production` profile
- [ ] Internal testing completed on a physical Android device
- [ ] Play Console application/configuration completed
- [ ] Store metadata and screenshots supplied
- [ ] Privacy/data-safety declarations completed from the actual data audit
- [ ] Background location disclosure/Play Console requirements reviewed because active delivery tracking uses background location

## IOS

- [ ] Bundle identifier verified: `com.rideon.app`
- [ ] EAS iOS signing credentials configured
- [ ] Production IPA/archive built with `production` profile
- [ ] TestFlight testing completed on a physical iPhone
- [ ] App Store metadata completed
- [ ] Privacy information completed from the actual data audit
- [ ] Background location disclosure/Apple review requirements reviewed because active delivery tracking uses background location

## FINAL

- [ ] Production smoke test completed against the real Render API
- [ ] Crash/error monitoring configured or consciously deferred
- [ ] Support contact verified
- [ ] Privacy Policy URL verified
- [ ] Terms of Service URL verified
- [ ] App icon and splash assets supplied and validated
- [ ] Production payment smoke test completed
- [ ] Production map and location smoke test completed
- [ ] Final Android/iOS version and build numbers recorded

## Store metadata placeholders

**App name:** RideOn

**Short description:** Vehicle rental marketplace connecting customers with verified vehicle vendors.

**Full description:** _To be finalized by the product owner; do not publish placeholder copy._

**Privacy Policy URL:** _REQUIRED — supply the real public URL._

**Terms of Service URL:** _REQUIRED — supply the real public URL._

**Support URL:** _REQUIRED — supply the real public support URL._

**Contact email:** _REQUIRED — supply the production support email._

**App screenshots:** _REQUIRED — capture release-build screenshots for Android and iOS._

**Category:** _REQUIRED — choose the actual marketplace/vehicle-rental category applicable in each store._

**Age rating:** _REQUIRED — complete the official store questionnaire._

**Data safety / privacy declarations:** _REQUIRED — complete from docs/MOBILE_PRODUCTION_RELEASE.md and actual production provider configuration._

## Release commands

After the EAS project is linked and EAS production environment variables are configured:

```bash
eas build --platform android --profile production
eas build --platform ios --profile production
```

Build only. Do not run `eas submit` until the checklist is complete.
