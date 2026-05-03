[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48)).Replace('+','-').Replace('/','_').TrimEnd('=')
